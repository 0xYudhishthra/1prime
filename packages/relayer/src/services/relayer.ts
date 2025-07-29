import { EventEmitter } from "events";
import type { Logger } from "winston";
import {
  FusionOrder,
  FusionOrderExtended,
  OrderStatus,
  CreateOrderRequest,
  ResolverBidRequest,
  SecretRevealRequest,
  RelayerStatus,
  HealthCheckResponse,
} from "../types";
import { OrderManager } from "./order-manager";
import { EscrowVerifier } from "./escrow-verifier";
import { SecretManager, SecretRevealConditions } from "./secret-manager";
import { TimelockManager } from "./timelock-manager";
import { ChainAdapterFactory } from "../adapters";
import { isValidChainPair, getChainConfig } from "../config/chains";
import { DatabaseService } from "./database";

export interface RelayerServiceConfig {
  chainIds: string[];
  privateKeys?: Record<string, string>;
  enablePartialFills: boolean;
  healthCheckInterval: number;
}

export class RelayerService extends EventEmitter {
  private logger: Logger;
  private config: RelayerServiceConfig;
  private databaseService: DatabaseService;
  private orderManager: OrderManager;
  private escrowVerifier: EscrowVerifier;
  private secretManager: SecretManager;
  private timelockManager: TimelockManager;

  private isInitialized = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private stats: {
    ordersCreated: number;
    ordersCompleted: number;
    ordersCancelled: number;
    totalVolume: string;
    uptime: number;
  };

  constructor(
    logger: Logger,
    config: RelayerServiceConfig,
    databaseService: DatabaseService
  ) {
    super();
    this.logger = logger;
    this.config = config;
    this.databaseService = databaseService;
    this.stats = {
      ordersCreated: 0,
      ordersCompleted: 0,
      ordersCancelled: 0,
      totalVolume: "0",
      uptime: Date.now(),
    };

    // Initialize core services
    this.orderManager = new OrderManager(logger);
    this.escrowVerifier = new EscrowVerifier(logger);
    this.secretManager = new SecretManager(logger);
    this.timelockManager = new TimelockManager(logger);

    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        this.logger.warn("Relayer service already initialized");
        return;
      }

      // Initialize chain adapters
      await this.escrowVerifier.initializeAdapters(
        this.config.chainIds,
        this.config.privateKeys
      );

      // Initialize timelock manager
      await this.timelockManager.initialize();

      // Start health checks
      this.startHealthChecks();

      this.isInitialized = true;
      this.logger.info("Relayer service initialized successfully", {
        chainIds: this.config.chainIds,
      });

      this.emit("relayer_initialized");
    } catch (error) {
      this.logger.error("Failed to initialize relayer service", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async createOrder(
    request: CreateOrderRequest,
    maker: string
  ): Promise<OrderStatus> {
    try {
      this.validateInitialized();

      // Validate chain pair
      if (!isValidChainPair(request.sourceChain, request.destinationChain)) {
        throw new Error(
          `Invalid chain pair: ${request.sourceChain} -> ${request.destinationChain}`
        );
      }

      // Create the order
      const order = await this.orderManager.createOrder(request, maker);

      // Setup timelocks
      await this.timelockManager.setupOrderTimelocks(order);

      // Store secret for later revelation
      await this.secretManager.storeSecret(
        order.orderHash,
        "placeholder-secret",
        order.secretHash
      );

      // Handle partial fills if enabled
      if (this.config.enablePartialFills) {
        await this.secretManager.createMerkleSecretTree(
          order.orderHash,
          4,
          "master-secret"
        );
      }

      this.stats.ordersCreated++;

      const orderStatus = this.orderManager.getOrderStatus(order.orderHash);
      if (!orderStatus) {
        throw new Error("Failed to create order status");
      }

      this.logger.info("Order created successfully", {
        orderHash: order.orderHash,
        maker,
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
      });

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to create order", {
        error: (error as Error).message,
        request,
      });
      throw error;
    }
  }

  /**
   * Create order from SDK CrossChainOrder format
   */
  async createOrderFromSDK(
    fusionOrder: FusionOrderExtended
  ): Promise<OrderStatus> {
    try {
      this.validateInitialized();

      // Create the order through OrderManager
      const orderStatus = await this.orderManager.createOrderFromSDK(
        fusionOrder
      );

      // Start timelock monitoring with enhanced phases
      if (fusionOrder.detailedTimeLocks) {
        await this.timelockManager.startMonitoring(fusionOrder.orderHash);
      }

      this.logger.info("SDK Order created successfully", {
        orderHash: fusionOrder.orderHash,
        maker: fusionOrder.maker,
        sourceChain: fusionOrder.sourceChain,
        destinationChain: fusionOrder.destinationChain,
        srcSafetyDeposit: fusionOrder.srcSafetyDeposit,
        dstSafetyDeposit: fusionOrder.dstSafetyDeposit,
      });

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to create SDK order", {
        error: (error as Error).message,
        fusionOrder,
      });
      throw error;
    }
  }

  async submitResolverBid(bid: ResolverBidRequest): Promise<boolean> {
    try {
      this.validateInitialized();

      // Submit bid to order manager
      const bidAccepted = await this.orderManager.submitResolverBid(bid);

      if (bidAccepted) {
        // Transition to deposit phase
        await this.timelockManager.transitionToDepositPhase(
          bid.orderHash,
          bid.resolver
        );

        // Start monitoring escrow creation
        const order = this.orderManager.getOrder(bid.orderHash);
        if (order) {
          await this.escrowVerifier.monitorEscrowCreation(order, bid.resolver);
        }

        this.logger.info("Resolver bid accepted", {
          orderHash: bid.orderHash,
          resolver: bid.resolver,
        });
      }

      return bidAccepted;
    } catch (error) {
      this.logger.error("Failed to submit resolver bid", {
        error: (error as Error).message,
        bid,
      });
      throw error;
    }
  }

  async requestSecretReveal(
    request: SecretRevealRequest
  ): Promise<string | null> {
    try {
      this.validateInitialized();

      const secret = await this.secretManager.requestSecretReveal(request);

      if (secret) {
        this.logger.info("Secret revealed", {
          orderHash: request.orderHash,
        });
      }

      return secret;
    } catch (error) {
      this.logger.error("Failed to reveal secret", {
        error: (error as Error).message,
        orderHash: request.orderHash,
      });
      throw error;
    }
  }

  async getOrderStatus(orderHash: string): Promise<OrderStatus | null> {
    try {
      this.validateInitialized();

      const orderStatus = this.orderManager.getOrderStatus(orderHash);
      if (!orderStatus) {
        return null;
      }

      // Enrich with current timelock information
      const timelock = this.timelockManager.getTimelockPhase(orderHash);
      if (timelock) {
        orderStatus.timelock = timelock;
      }

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to get order status", {
        error: (error as Error).message,
        orderHash,
      });
      throw error;
    }
  }

  async getActiveOrders(): Promise<FusionOrder[]> {
    try {
      this.validateInitialized();
      return this.orderManager.getActiveOrders();
    } catch (error) {
      this.logger.error("Failed to get active orders", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async registerResolver(resolver: RelayerStatus): Promise<void> {
    try {
      this.validateInitialized();

      this.orderManager.registerResolver(resolver);
      this.secretManager.registerResolver(resolver);

      this.logger.info("Resolver registered", {
        address: resolver.address,
        reputation: resolver.reputation,
        isKyc: resolver.isKyc,
      });
    } catch (error) {
      this.logger.error("Failed to register resolver", {
        error: (error as Error).message,
        resolver: resolver.address,
      });
      throw error;
    }
  }

  async getHealthStatus(): Promise<HealthCheckResponse> {
    try {
      const chainStatuses: Record<
        string,
        { connected: boolean; blockNumber: number; latency: number }
      > = {};

      // Check each chain connection
      for (const chainId of this.config.chainIds) {
        const startTime = Date.now();
        try {
          const config = getChainConfig(chainId);
          const adapter = ChainAdapterFactory.getAdapter(chainId, config.type);

          if (adapter) {
            const blockNumber = await adapter.getBlockNumber();
            const latency = Date.now() - startTime;

            chainStatuses[chainId] = {
              connected: true,
              blockNumber,
              latency,
            };
          } else {
            chainStatuses[chainId] = {
              connected: false,
              blockNumber: 0,
              latency: 0,
            };
          }
        } catch (error) {
          chainStatuses[chainId] = {
            connected: false,
            blockNumber: 0,
            latency: Date.now() - startTime,
          };
        }
      }

      const activeOrders = this.orderManager.getActiveOrders().length;
      const uptime = Date.now() - this.stats.uptime;
      const errorRate = this.calculateErrorRate();

      const status: HealthCheckResponse = {
        status: this.isHealthy(chainStatuses) ? "healthy" : "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        chains: chainStatuses,
        activeOrders,
        completedOrders: this.stats.ordersCompleted,
        errorRate,
      };

      return status;
    } catch (error) {
      this.logger.error("Failed to get health status", {
        error: (error as Error).message,
      });

      return {
        status: "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        chains: {},
        activeOrders: 0,
        completedOrders: 0,
        errorRate: 1.0,
      };
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info("Shutting down relayer service...");

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      await this.timelockManager.cleanup();
      this.secretManager.cleanup();

      this.isInitialized = false;

      this.logger.info("Relayer service shutdown completed");
      this.emit("relayer_shutdown");
    } catch (error) {
      this.logger.error("Error during shutdown", {
        error: (error as Error).message,
      });
    }
  }

  private setupEventHandlers(): void {
    // Order Manager Events
    this.orderManager.on("order_created", (order: FusionOrder) => {
      this.emit("order_created", order);
    });

    this.orderManager.on("auction_won", (data: any) => {
      this.emit("auction_won", data);
    });

    this.orderManager.on("order_completed", (data: any) => {
      this.stats.ordersCompleted++;
      this.emit("order_completed", data);
    });

    this.orderManager.on("order_cancelled", (data: any) => {
      this.stats.ordersCancelled++;
      this.emit("order_cancelled", data);
    });

    // Escrow Verifier Events
    this.escrowVerifier.on("escrows_verified", async (result: any) => {
      await this.handleEscrowsVerified(result);
    });

    this.escrowVerifier.on("escrow_timeout", (data: any) => {
      this.handleEscrowTimeout(data);
    });

    // Secret Manager Events
    this.secretManager.on("secret_revealed", (data: any) => {
      this.emit("secret_revealed", data);
    });

    // Timelock Manager Events
    this.timelockManager.on("finalization_completed", async (data: any) => {
      await this.handleFinalizationCompleted(data);
    });

    this.timelockManager.on("exclusive_withdrawal_ended", (data: any) => {
      this.emit("exclusive_withdrawal_ended", data);
    });
  }

  private async handleEscrowsVerified(result: any): Promise<void> {
    try {
      const { orderHash } = result;

      // Transition to withdrawal phase
      await this.timelockManager.transitionToWithdrawalPhase(orderHash);

      // Set secret reveal conditions
      const conditions: SecretRevealConditions = {
        orderHash,
        escrowsVerified: true,
        finalityReached: true, // Will be updated based on actual finality
        resolverVerified: true,
        timeConditionsMet: true,
      };

      await this.secretManager.setRevealConditions(orderHash, conditions);

      this.logger.info(
        "Both escrows verified and secret reveal conditions set",
        { orderHash }
      );
    } catch (error) {
      this.logger.error("Failed to handle escrows verified", {
        error: (error as Error).message,
        orderHash: result.orderHash,
      });
    }
  }

  private handleEscrowTimeout(data: any): void {
    const { orderHash, reason } = data;

    // Cancel the order due to escrow timeout
    this.orderManager.cancelOrder(orderHash, reason);

    this.logger.warn("Order cancelled due to escrow timeout", {
      orderHash,
      reason,
    });
  }

  private async handleFinalizationCompleted(data: any): Promise<void> {
    try {
      const { orderHash } = data;

      // Update secret reveal conditions to allow revelation
      const existingConditions = this.secretManager.getSecret(orderHash);
      if (existingConditions) {
        const conditions: SecretRevealConditions = {
          orderHash,
          escrowsVerified: true,
          finalityReached: true,
          resolverVerified: true,
          timeConditionsMet: true,
        };

        await this.secretManager.setRevealConditions(orderHash, conditions);
      }

      this.logger.info("Finalization completed, secret ready for revelation", {
        orderHash,
      });
    } catch (error) {
      this.logger.error("Failed to handle finalization completed", {
        error: (error as Error).message,
        orderHash: data.orderHash,
      });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();

        if (health.status === "unhealthy") {
          this.logger.warn("Health check failed", { health });
          this.emit("health_check_failed", health);
        }
      } catch (error) {
        this.logger.error("Health check error", {
          error: (error as Error).message,
        });
      }
    }, this.config.healthCheckInterval);
  }

  private validateInitialized(): void {
    if (!this.isInitialized) {
      throw new Error("Relayer service not initialized");
    }
  }

  private isHealthy(chainStatuses: Record<string, any>): boolean {
    // At least 80% of chains must be connected
    const totalChains = Object.keys(chainStatuses).length;
    const connectedChains = Object.values(chainStatuses).filter(
      (status: any) => status.connected
    ).length;

    return connectedChains / totalChains >= 0.8;
  }

  private calculateErrorRate(): number {
    const total = this.stats.ordersCreated;
    const errors = this.stats.ordersCancelled;

    if (total === 0) return 0;
    return errors / total;
  }
}
