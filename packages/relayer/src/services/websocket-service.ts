import { EventEmitter } from "events";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { createServer, Server, IncomingMessage } from "http";
import type { Logger } from "winston";

export interface WebSocketMessage {
  event: string;
  data: any;
  timestamp: number;
  orderHash?: string;
}

export interface ClientConnection {
  id: string;
  socket: WebSocket;
  subscribedEvents: string[];
  subscribedOrders: string[];
  connectedAt: number;
  lastPing: number;
}

export class WebSocketService extends EventEmitter {
  private logger: Logger;
  private wss?: WebSocketServer;
  private server?: Server;
  private clients = new Map<string, ClientConnection>();
  private pingInterval?: NodeJS.Timeout;

  // Supported WebSocket events
  private readonly supportedEvents = [
    "order_created",
    "auction_started",
    "auction_progress",
    "gas_adjustment",
    "partial_fill",
    "auction_won",
    "secret_revealed",
    "order_completed",
    "order_cancelled",
    "phase_transition",
  ];

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Start WebSocket server
   */
  async start(port: number = 3001): Promise<void> {
    try {
      // Create HTTP server for WebSocket
      this.server = createServer();

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.server,
        path: "/ws",
      });

      // Setup WebSocket connection handling
      this.wss.on("connection", (ws, request) => {
        this.handleConnection(ws, request);
      });

      // Start HTTP server
      this.server.listen(port, () => {
        this.logger.info("WebSocket server started", {
          port,
          path: "/ws",
          supportedEvents: this.supportedEvents.length,
        });
      });

      // Start ping/pong for connection health
      this.startPingPong();
    } catch (error) {
      this.logger.error("Failed to start WebSocket server", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop WebSocket server
   */
  async stop(): Promise<void> {
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.socket.close(1000, "Server shutting down");
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    // Close HTTP server
    if (this.server) {
      this.server.close();
    }

    this.logger.info("WebSocket server stopped");
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const clientId = this.generateClientId();
    const clientIP = request.socket.remoteAddress;

    const client: ClientConnection = {
      id: clientId,
      socket: ws,
      subscribedEvents: [],
      subscribedOrders: [],
      connectedAt: Date.now(),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);

    this.logger.info("WebSocket client connected", {
      clientId,
      clientIP,
      totalClients: this.clients.size,
    });

    // Send welcome message
    this.sendToClient(clientId, {
      event: "connection_established",
      data: {
        clientId,
        supportedEvents: this.supportedEvents,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    // Handle messages from client
    ws.on("message", data => {
      this.handleClientMessage(clientId, data);
    });

    // Handle client disconnect
    ws.on("close", (code, reason) => {
      this.handleDisconnection(clientId, code, reason);
    });

    // Handle connection errors
    ws.on("error", error => {
      this.logger.error("WebSocket client error", {
        clientId,
        error: error.message,
      });
    });

    // Handle pong responses
    ws.on("pong", () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastPing = Date.now();
      }
    });
  }

  /**
   * Handle messages from WebSocket clients
   */
  private handleClientMessage(clientId: string, data: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe_events":
          this.handleEventSubscription(clientId, message.events);
          break;

        case "subscribe_order":
          this.handleOrderSubscription(clientId, message.orderHash);
          break;

        case "unsubscribe_events":
          this.handleEventUnsubscription(clientId, message.events);
          break;

        case "unsubscribe_order":
          this.handleOrderUnsubscription(clientId, message.orderHash);
          break;

        case "ping":
          this.sendToClient(clientId, {
            event: "pong",
            data: { timestamp: Date.now() },
            timestamp: Date.now(),
          });
          break;

        default:
          this.logger.warn("Unknown WebSocket message type", {
            clientId,
            messageType: message.type,
          });
      }
    } catch (error) {
      this.logger.error("Failed to parse WebSocket message", {
        clientId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(
    clientId: string,
    code: number,
    reason: Buffer
  ): void {
    this.clients.delete(clientId);

    this.logger.info("WebSocket client disconnected", {
      clientId,
      code,
      reason: reason.toString(),
      remainingClients: this.clients.size,
    });
  }

  /**
   * Subscribe client to specific events
   */
  private handleEventSubscription(clientId: string, events: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const validEvents = events.filter(event =>
      this.supportedEvents.includes(event)
    );
    client.subscribedEvents = [
      ...new Set([...client.subscribedEvents, ...validEvents]),
    ];

    this.sendToClient(clientId, {
      event: "subscription_confirmed",
      data: {
        subscribedEvents: client.subscribedEvents,
        invalidEvents: events.filter(e => !this.supportedEvents.includes(e)),
      },
      timestamp: Date.now(),
    });

    this.logger.debug("Client subscribed to events", {
      clientId,
      events: validEvents,
    });
  }

  /**
   * Subscribe client to specific order updates
   */
  private handleOrderSubscription(clientId: string, orderHash: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!client.subscribedOrders.includes(orderHash)) {
      client.subscribedOrders.push(orderHash);
    }

    this.sendToClient(clientId, {
      event: "order_subscription_confirmed",
      data: { orderHash, subscribedOrders: client.subscribedOrders },
      timestamp: Date.now(),
    });

    this.logger.debug("Client subscribed to order", { clientId, orderHash });
  }

  /**
   * Unsubscribe client from events
   */
  private handleEventUnsubscription(clientId: string, events: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedEvents = client.subscribedEvents.filter(
      e => !events.includes(e)
    );

    this.sendToClient(clientId, {
      event: "unsubscription_confirmed",
      data: {
        unsubscribedEvents: events,
        remainingEvents: client.subscribedEvents,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Unsubscribe client from order
   */
  private handleOrderUnsubscription(clientId: string, orderHash: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedOrders = client.subscribedOrders.filter(
      h => h !== orderHash
    );

    this.sendToClient(clientId, {
      event: "order_unsubscription_confirmed",
      data: { orderHash, remainingOrders: client.subscribedOrders },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast event to all subscribed clients
   */
  broadcast(event: string, data: any, orderHash?: string): void {
    const message: WebSocketMessage = {
      event,
      data,
      timestamp: Date.now(),
      orderHash,
    };

    let sentCount = 0;

    for (const [clientId, client] of this.clients) {
      const shouldSend =
        client.subscribedEvents.includes(event) ||
        (orderHash && client.subscribedOrders.includes(orderHash));

      if (shouldSend) {
        this.sendToClient(clientId, message);
        sentCount++;
      }
    }

    this.logger.debug("Broadcasted WebSocket event", {
      event,
      orderHash,
      sentToClients: sentCount,
      totalClients: this.clients.size,
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(clientId: string, message: WebSocketMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      this.logger.error("Failed to send WebSocket message", {
        clientId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start ping/pong for connection health monitoring
   */
  private startPingPong(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const pingTimeout = 30000; // 30 seconds

      for (const [clientId, client] of this.clients) {
        if (client.socket.readyState === WebSocket.OPEN) {
          // Check if client responded to last ping
          if (now - client.lastPing > pingTimeout) {
            this.logger.warn("Client ping timeout", { clientId });
            client.socket.terminate();
            this.clients.delete(clientId);
          } else {
            // Send ping
            client.socket.ping();
          }
        }
      }
    }, 15000); // Ping every 15 seconds
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current WebSocket statistics
   */
  getStats(): {
    totalClients: number;
    connectedClients: number;
    totalSubscriptions: number;
    uptime: number;
  } {
    const connectedClients = Array.from(this.clients.values()).filter(
      client => client.socket.readyState === WebSocket.OPEN
    ).length;

    const totalSubscriptions = Array.from(this.clients.values()).reduce(
      (sum, client) =>
        sum + client.subscribedEvents.length + client.subscribedOrders.length,
      0
    );

    return {
      totalClients: this.clients.size,
      connectedClients,
      totalSubscriptions,
      uptime: this.server ? Date.now() - (this.server as any).startTime : 0,
    };
  }

  /**
   * Get list of supported events
   */
  getSupportedEvents(): string[] {
    return [...this.supportedEvents];
  }
}
