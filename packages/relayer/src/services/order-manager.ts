import { EventEmitter } from "events";
import type { Logger } from "winston";
import {
  FusionOrder,
  FusionOrderExtended,
  DutchAuctionState,
  OrderStatus,
  OrderEvent,
  TimelockPhase,
  RelayerStatus,
  ResolverBidRequest,
} from "../types";
import { createHash } from "crypto";
import { PartialFillManager } from "./partial-fill-manager";
import { CustomCurveManager } from "./custom-curve-manager";

export class OrderManager extends EventEmitter {
  private logger: Logger;
  private orders: Map<string, FusionOrder> = new Map();
  private orderStatuses: Map<string, OrderStatus> = new Map();
  private auctions: Map<string, DutchAuctionState> = new Map();
  private resolvers: Map<string, RelayerStatus> = new Map();

  // Enhanced managers for partial fills and custom curves
  private partialFillManager: PartialFillManager;
  private customCurveManager: CustomCurveManager;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.partialFillManager = new PartialFillManager(logger);
    this.customCurveManager = new CustomCurveManager(logger);

    // Start gas monitoring for custom curves
    this.customCurveManager.startGasMonitoring();
  }

  /**
   * Create order from SDK CrossChainOrder format
   */
  async createOrderFromSDK(
    fusionOrder: FusionOrderExtended
  ): Promise<OrderStatus> {
    try {
      // Validate order
      this.validateSDKOrder(fusionOrder);

      // Store order (convert to base FusionOrder for storage)
      const baseFusionOrder: FusionOrder = {
        orderHash: fusionOrder.orderHash,
        maker: fusionOrder.maker,
        sourceChain: fusionOrder.sourceChain,
        destinationChain: fusionOrder.destinationChain,
        sourceToken: fusionOrder.sourceToken,
        destinationToken: fusionOrder.destinationToken,
        sourceAmount: fusionOrder.sourceAmount,
        destinationAmount: fusionOrder.destinationAmount,
        secretHash: fusionOrder.secretHash,
        timeout: fusionOrder.timeout,
        auctionStartTime: fusionOrder.auctionStartTime,
        auctionDuration: fusionOrder.auctionDuration,
        initialRateBump: fusionOrder.initialRateBump,
        signature: fusionOrder.signature,
        nonce: fusionOrder.nonce,
        createdAt: fusionOrder.createdAt,
      };
      this.orders.set(fusionOrder.orderHash, baseFusionOrder);

      // Initialize order status
      const orderStatus: OrderStatus = {
        orderHash: fusionOrder.orderHash,
        phase: "announcement",
        isCompleted: false,
        events: [
          this.createOrderEvent("order_created", {
            order: fusionOrder,
            sdkExtracted: true,
            srcSafetyDeposit: fusionOrder.srcSafetyDeposit,
            dstSafetyDeposit: fusionOrder.dstSafetyDeposit,
            detailedTimeLocks: fusionOrder.detailedTimeLocks,
          }),
        ],
      };
      this.orderStatuses.set(fusionOrder.orderHash, orderStatus);

      // Start Dutch auction with SDK auction details
      this.startDutchAuctionFromSDK(fusionOrder);

      // Initialize partial fills if supported (Section 2.5 of whitepaper)
      if (this.partialFillManager.supportsPartialFills(fusionOrder)) {
        this.partialFillManager.initializePartialFill(fusionOrder);
        this.logger.info("Partial fills enabled for order", {
          orderHash: fusionOrder.orderHash,
          fillParts: fusionOrder.merkleSecretTree?.fillParts,
          secretCount: fusionOrder.merkleSecretTree?.secretCount,
        });
      }

      // Initialize custom curve with gas adjustments (Section 2.3.4 of whitepaper)
      this.customCurveManager.initializeCustomCurve(fusionOrder);

      this.logger.info("SDK Order created", {
        orderHash: fusionOrder.orderHash,
        maker: fusionOrder.maker,
        srcSafetyDeposit: fusionOrder.srcSafetyDeposit,
        dstSafetyDeposit: fusionOrder.dstSafetyDeposit,
        supportsPartialFills: fusionOrder.allowPartialFills,
        hasCustomCurve: !!fusionOrder.enhancedAuctionDetails?.points.length,
      });
      this.emit("order_created", baseFusionOrder);

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to create SDK order", {
        error: (error as Error).message,
        orderHash: fusionOrder.orderHash,
      });
      throw error;
    }
  }

  async submitResolverBid(bid: ResolverBidRequest): Promise<boolean> {
    try {
      const order = this.orders.get(bid.orderHash);
      if (!order) {
        throw new Error(`Order not found: ${bid.orderHash}`);
      }

      const auction = this.auctions.get(bid.orderHash);
      if (!auction || !auction.isActive) {
        throw new Error(`Auction not active for order: ${bid.orderHash}`);
      }

      const resolver = this.resolvers.get(bid.resolver);
      if (!resolver) {
        throw new Error(`Resolver not registered: ${bid.resolver}`);
      }

      // Validate resolver is KYC approved
      if (!resolver.isKyc) {
        throw new Error("Resolver must be KYC approved to participate");
      }

      // Calculate current auction price
      const currentRate = this.calculateCurrentAuctionRate(auction);

      // Check if bid is profitable for resolver
      const gasEstimate = bid.estimatedGas;
      const isProfitable = this.isBidProfitable(
        order,
        currentRate,
        gasEstimate
      );

      if (!isProfitable) {
        this.logger.warn("Bid not profitable", {
          orderHash: bid.orderHash,
          resolver: bid.resolver,
        });
        return false;
      }

      // Accept the bid - first profitable bid wins
      auction.winner = bid.resolver;
      auction.finalRate = currentRate;
      auction.isActive = false;

      // Update order status
      const orderStatus = this.orderStatuses.get(bid.orderHash)!;
      orderStatus.phase = "deposit";
      orderStatus.auction = auction;
      orderStatus.events.push(
        this.createOrderEvent("auction_started", {
          winner: bid.resolver,
          finalRate: currentRate,
        })
      );

      this.logger.info("Auction won", {
        orderHash: bid.orderHash,
        winner: bid.resolver,
        finalRate: currentRate,
      });

      this.emit("auction_won", {
        orderHash: bid.orderHash,
        winner: bid.resolver,
        finalRate: currentRate,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to submit resolver bid", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateOrderPhase(
    orderHash: string,
    phase: TimelockPhase["phase"]
  ): Promise<void> {
    const orderStatus = this.orderStatuses.get(orderHash);
    if (!orderStatus) {
      throw new Error(`Order not found: ${orderHash}`);
    }

    const previousPhase = orderStatus.phase;
    orderStatus.phase = phase;
    orderStatus.events.push(
      this.createOrderEvent("order_created", {
        phase,
        previousPhase,
      })
    );

    this.logger.info("Order phase updated", {
      orderHash,
      phase,
      previousPhase,
    });
    this.emit("phase_changed", { orderHash, phase, previousPhase });
  }

  async completeOrder(orderHash: string, secret: string): Promise<void> {
    const orderStatus = this.orderStatuses.get(orderHash);
    if (!orderStatus) {
      throw new Error(`Order not found: ${orderHash}`);
    }

    orderStatus.isCompleted = true;
    orderStatus.events.push(
      this.createOrderEvent("withdrawal_completed", { secret })
    );

    this.logger.info("Order completed", { orderHash });
    this.emit("order_completed", { orderHash, secret });
  }

  async cancelOrder(orderHash: string, reason: string): Promise<void> {
    const orderStatus = this.orderStatuses.get(orderHash);
    if (!orderStatus) {
      throw new Error(`Order not found: ${orderHash}`);
    }

    orderStatus.phase = "recovery";
    orderStatus.error = reason;
    orderStatus.events.push(
      this.createOrderEvent("order_cancelled", { reason })
    );

    // Stop auction if active
    const auction = this.auctions.get(orderHash);
    if (auction && auction.isActive) {
      auction.isActive = false;
    }

    this.logger.info("Order cancelled", { orderHash, reason });
    this.emit("order_cancelled", { orderHash, reason });
  }

  getOrder(orderHash: string): FusionOrder | undefined {
    return this.orders.get(orderHash);
  }

  getOrderStatus(orderHash: string): OrderStatus | undefined {
    return this.orderStatuses.get(orderHash);
  }

  getActiveOrders(): FusionOrder[] {
    return Array.from(this.orders.values()).filter(order => {
      const status = this.orderStatuses.get(order.orderHash);
      return status && !status.isCompleted;
    });
  }

  getAuction(orderHash: string): DutchAuctionState | undefined {
    return this.auctions.get(orderHash);
  }

  registerResolver(resolver: RelayerStatus): void {
    this.resolvers.set(resolver.address, resolver);
    this.logger.info("Resolver registered", {
      address: resolver.address,
      reputation: resolver.reputation,
    });
  }

  private startDutchAuction(order: FusionOrder): void {
    const auction: DutchAuctionState = {
      orderHash: order.orderHash,
      startTime: order.auctionStartTime,
      duration: order.auctionDuration,
      initialRateBump: order.initialRateBump,
      currentRate: order.initialRateBump,
      isActive: true,
      participatingResolvers: [],
    };

    this.auctions.set(order.orderHash, auction);

    // Start price decay timer
    const priceUpdateInterval = setInterval(() => {
      if (!auction.isActive) {
        clearInterval(priceUpdateInterval);
        return;
      }

      auction.currentRate = this.calculateCurrentAuctionRate(auction);

      // Check if auction should end
      if (Date.now() - auction.startTime > auction.duration) {
        auction.isActive = false;
        clearInterval(priceUpdateInterval);
        this.logger.warn("Auction expired without winner", {
          orderHash: order.orderHash,
        });
        this.emit("auction_expired", { orderHash: order.orderHash });
      }
    }, 1000); // Update every second

    this.logger.info("Dutch auction started", {
      orderHash: order.orderHash,
      initialRateBump: order.initialRateBump,
    });
  }

  private calculateCurrentAuctionRate(auction: DutchAuctionState): number {
    // Try to use custom curve manager first (with gas adjustments)
    const customRate = this.customCurveManager.calculateAdjustedRate(
      auction.orderHash
    );
    if (customRate > 0) {
      return customRate;
    }

    // Fallback to simple linear decay
    const timeSinceStart = Date.now() - auction.startTime;
    const progress = Math.min(timeSinceStart / auction.duration, 1);

    const currentRate = auction.initialRateBump * (1 - progress);
    return Math.max(currentRate, 0);
  }

  private isBidProfitable(
    order: FusionOrder,
    currentRate: number,
    gasEstimate: number
  ): boolean {
    // Simplified profitability check for testing
    // In production this would use real gas prices and token prices from oracles
    const rateBump = currentRate / 10000; // Convert basis points to decimal

    // For testing: consider profitable if rate adjustment is at least 1% of destination amount
    const rateAdjustment = parseFloat(order.destinationAmount) * rateBump;
    const minProfit = parseFloat(order.destinationAmount) * 0.01; // 1% of destination amount

    return rateAdjustment >= minProfit;
  }

  private validateOrder(order: FusionOrder): void {
    if (!order.orderHash || !order.maker) {
      throw new Error("Invalid order: missing required fields");
    }

    if (
      parseFloat(order.sourceAmount) <= 0 ||
      parseFloat(order.destinationAmount) <= 0
    ) {
      throw new Error("Invalid order: amounts must be positive");
    }

    if (order.timeout <= Date.now()) {
      throw new Error("Invalid order: timeout must be in the future");
    }

    if (order.auctionDuration < 30000 || order.auctionDuration > 300000) {
      throw new Error(
        "Invalid order: auction duration must be between 30s and 5min"
      );
    }
  }

  private validateSDKOrder(order: FusionOrderExtended): void {
    // Run base validation first
    this.validateOrder(order);

    // Validate SDK-specific fields
    if (order.detailedTimeLocks) {
      const timeLocks = order.detailedTimeLocks;
      if (
        timeLocks.srcWithdrawal < 1 ||
        timeLocks.dstWithdrawal < 1 ||
        timeLocks.srcPublicWithdrawal <= timeLocks.srcWithdrawal ||
        timeLocks.dstPublicWithdrawal <= timeLocks.dstWithdrawal
      ) {
        throw new Error("Invalid SDK order: invalid timelock configuration");
      }
    }

    // Validate safety deposits
    if (order.srcSafetyDeposit && parseFloat(order.srcSafetyDeposit) <= 0) {
      throw new Error(
        "Invalid SDK order: source safety deposit must be positive"
      );
    }
    if (order.dstSafetyDeposit && parseFloat(order.dstSafetyDeposit) <= 0) {
      throw new Error(
        "Invalid SDK order: destination safety deposit must be positive"
      );
    }
  }

  private startDutchAuctionFromSDK(order: FusionOrderExtended): void {
    // Use enhanced auction details if available, otherwise fall back to base auction
    const auctionDuration =
      (order.enhancedAuctionDetails?.points?.length || 0) > 0
        ? order.auctionDuration
        : order.auctionDuration;

    const auction: DutchAuctionState = {
      orderHash: order.orderHash,
      startTime: order.auctionStartTime,
      duration: auctionDuration,
      initialRateBump: order.initialRateBump,
      currentRate: order.initialRateBump,
      isActive: true,
      participatingResolvers: [],
    };

    this.auctions.set(order.orderHash, auction);

    this.logger.info("SDK Dutch auction started", {
      orderHash: order.orderHash,
      duration: auctionDuration,
      initialRateBump: order.initialRateBump,
      hasEnhancedPoints: !!order.enhancedAuctionDetails?.points.length,
    });

    this.emit("auction_started", auction);
  }

  private createOrderEvent(type: OrderEvent["type"], data: any): OrderEvent {
    return {
      type,
      timestamp: Date.now(),
      data,
    };
  }
}
