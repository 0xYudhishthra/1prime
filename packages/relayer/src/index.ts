import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createLogger, format, transports } from "winston";
import dotenv from "dotenv";
import { RelayerService, RelayerServiceConfig } from "./services/relayer";
import { DatabaseService, DatabaseConfig } from "./services/database";
import { WebSocketService } from "./services/websocket-service";
import { createRelayerRoutes } from "./api/routes";
import { RelayerConfig } from "./types";

// Load environment variables
dotenv.config();

// Create logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
    ...(process.env.LOG_FILE
      ? [new transports.File({ filename: process.env.LOG_FILE })]
      : []),
  ],
});

// Configuration
const config: RelayerConfig = {
  port: parseInt(process.env.PORT || "3000", 10),
  environment:
    (process.env.NODE_ENV as "development" | "staging" | "production") ||
    "development",
  chains: {}, // Will be populated from environment
  logging: {
    level:
      (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
    ...(process.env.LOG_FILE && { file: process.env.LOG_FILE }),
  },
  security: {
    corsOrigins: (process.env.CORS_ORIGINS || "*").split(","),
  },
  database: {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_ANON_KEY || "",
  },
  monitoring: {
    healthCheckInterval: parseInt(
      process.env.HEALTH_CHECK_INTERVAL || "30000",
      10
    ),
    escrowCheckInterval: parseInt(
      process.env.ESCROW_CHECK_INTERVAL || "10000",
      10
    ),
    timelockCheckInterval: parseInt(
      process.env.TIMELOCK_CHECK_INTERVAL || "30000",
      10
    ),
  },
};

// Relayer service configuration
const relayerServiceConfig: RelayerServiceConfig = {
  chainIds: (process.env.SUPPORTED_CHAINS || "ethereum,near").split(","),
  privateKeys: Object.fromEntries(
    Object.entries({
      // Use single EVM private key for all EVM chains
      ethereum: process.env.EVM_PRIVATE_KEY,
      base: process.env.EVM_PRIVATE_KEY,
      bsc: process.env.EVM_PRIVATE_KEY,
      polygon: process.env.EVM_PRIVATE_KEY,
      arbitrum: process.env.EVM_PRIVATE_KEY,
      // NEAR chains use their own private key
      near: process.env.NEAR_PRIVATE_KEY,
      "near-testnet": process.env.NEAR_PRIVATE_KEY,
    }).filter(([_, value]) => value !== undefined)
  ) as Record<string, string>,
  enablePartialFills: process.env.ENABLE_PARTIAL_FILLS === "true",
  healthCheckInterval: config.monitoring.healthCheckInterval,
};

class RelayerApplication {
  private app: express.Application;
  private relayerService: RelayerService;
  private databaseService: DatabaseService;
  private webSocketService: WebSocketService;
  private server?: any;

  constructor() {
    this.app = express();

    // Initialize database service
    this.databaseService = new DatabaseService(config.database, logger);

    // Initialize WebSocket service
    this.webSocketService = new WebSocketService(logger);

    // Initialize relayer service with database
    this.relayerService = new RelayerService(
      logger,
      relayerServiceConfig,
      this.databaseService
    );

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      })
    );

    // CORS
    this.app.use(
      cors({
        origin: config.security.corsOrigins.includes("*")
          ? true
          : config.security.corsOrigins,
        credentials: true,
      })
    );

    // Body parsing
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.debug("API Request", {
        method: req.method,
        path: req.path,
        query: req.query,
        headers: {
          "user-agent": req.headers["user-agent"],
          "content-type": req.headers["content-type"],
        },
      });
      next();
    });

    // CORS and other middleware configured above
  }

  private setupRoutes(): void {
    // API routes
    this.app.use("/api/v1", createRelayerRoutes(this.relayerService, logger));

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        name: "1Prime Relayer Service",
        version: "1.0.0",
        description:
          "1inch Fusion+ compatible relayer for EVM <> NEAR cross-chain swaps",
        environment: config.environment,
        timestamp: new Date().toISOString(),
        endpoints: {
          health: "/api/v1/health",
          orders: "/api/v1/orders",
          bids: "/api/v1/bids",
          secrets: "/api/v1/secrets/reveal",
          resolvers: "/api/v1/resolvers",
          stats: "/api/v1/stats",
        },
      });
    });

    // 404 handler
    this.app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        error: "Endpoint not found",
        timestamp: Date.now(),
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use(
      (
        error: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        logger.error("Unhandled API error", {
          error: error.message,
          stack: error.stack,
          path: req.path,
          method: req.method,
        });

        if (res.headersSent) {
          return next(error);
        }

        res.status(500).json({
          success: false,
          error:
            config.environment === "development"
              ? error.message
              : "Internal server error",
          timestamp: Date.now(),
        });
      }
    );

    // Uncaught exception handler
    process.on("uncaughtException", error => {
      logger.error("Uncaught Exception", {
        error: error.message,
        stack: error.stack,
      });
      this.gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    // Unhandled rejection handler
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection", { reason, promise });
      this.gracefulShutdown("UNHANDLED_REJECTION");
    });

    // Graceful shutdown signals
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => this.gracefulShutdown("SIGINT"));
  }

  private setupEventHandlers(): void {
    // Relayer service events
    this.relayerService.on("relayer_initialized", () => {
      logger.info("Relayer service initialized successfully");
    });

    this.relayerService.on("order_created", order => {
      logger.info("New order created", {
        orderHash: order.orderHash,
        sourceChain: order.sourceChain,
        destinationChain: order.destinationChain,
      });
    });

    this.relayerService.on("auction_won", data => {
      logger.info("Auction won", {
        orderHash: data.orderHash,
        winner: data.winner,
        finalRate: data.finalRate,
      });
    });

    this.relayerService.on("secret_revealed", data => {
      logger.info("Secret revealed", {
        orderHash: data.orderHash,
        revealedTo: data.revealedTo,
      });
    });

    this.relayerService.on("order_completed", data => {
      logger.info("Order completed", {
        orderHash: data.orderHash,
      });
    });

    this.relayerService.on("order_cancelled", data => {
      logger.warn("Order cancelled", {
        orderHash: data.orderHash,
        reason: data.reason,
      });
    });

    this.relayerService.on("health_check_failed", health => {
      logger.warn("Health check failed", { health });
    });
  }

  async start(): Promise<void> {
    try {
      // Initialize relayer service
      await this.relayerService.initialize();

      // Start WebSocket server
      const wsPort = parseInt(process.env.WS_PORT || "3001");
      await this.webSocketService.start(wsPort);

      // Start HTTP server
      this.server = this.app.listen(config.port, () => {
        logger.info("Relayer service started", {
          port: config.port,
          wsPort,
          environment: config.environment,
          supportedChains: relayerServiceConfig.chainIds,
          websocketEnabled: true,
        });
      });

      this.server.on("error", (error: Error) => {
        logger.error("Server error", { error: error.message });
        this.gracefulShutdown("SERVER_ERROR");
      });
    } catch (error) {
      logger.error("Failed to start relayer service", {
        error: (error as Error).message,
      });
      process.exit(1);
    }
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info("Received shutdown signal, starting graceful shutdown", {
      signal,
    });

    try {
      // Stop accepting new requests
      if (this.server) {
        this.server.close(() => {
          logger.info("HTTP server closed");
        });
      }

      // Shutdown WebSocket service
      await this.webSocketService.stop();

      // Shutdown relayer service
      await this.relayerService.shutdown();

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown", {
        error: (error as Error).message,
      });
      process.exit(1);
    }
  }
}

// Start the application
const app = new RelayerApplication();
app.start().catch(error => {
  logger.error("Failed to start application", { error: error.message });
  process.exit(1);
});

export default app;
