import { EventEmitter } from "events";
import type { Logger } from "winston";
import {
  FusionOrder,
  FusionOrderExtended,
  OrderStatus,
  OrderEvent,
  TimelockPhase,
  RelayerStatus,
} from "../types";
import { createHash } from "crypto";
import { PartialFillManager } from "./partial-fill-manager";
import { CustomCurveManager } from "./custom-curve-manager";

export class OrderManager extends EventEmitter {
  private logger: Logger;
  private orders: Map<string, FusionOrder> = new Map();
  private orderStatuses: Map<string, OrderStatus> = new Map();

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
        userSrcAddress: fusionOrder.userSrcAddress,
        userDstAddress: fusionOrder.userDstAddress,
        sourceChain: fusionOrder.sourceChain,
        destinationChain: fusionOrder.destinationChain,
        sourceToken: fusionOrder.sourceToken,
        destinationToken: fusionOrder.destinationToken,
        sourceAmount: fusionOrder.sourceAmount,
        destinationAmount: fusionOrder.destinationAmount,
        secretHash: fusionOrder.secretHash,
        timeout: fusionOrder.timeout,

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
        hasCustomCurve: false, // Simplified without auction details
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

  async submitResolverBid(bid: any): Promise<boolean> {
    // Simplified - no auctions, just return true for single resolver
    this.logger.info("Resolver bid accepted (simplified)", {
      orderHash: bid.orderHash,
      resolver: bid.resolver || "single-resolver",
    });
    return true;
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

    // No auction to stop - simplified flow

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

  getAuction(orderHash: string): any | undefined {
    // Simplified - no auctions
    return undefined;
  }

  private startDutchAuction(order: FusionOrder): void {
    // Simplified - no auctions
    this.logger.info("Order ready for processing (no auction)", {
      orderHash: order.orderHash,
    });
  }

  private calculateCurrentAuctionRate(auction: any): number {
    // Simplified - no auctions, return default rate
    return 0;
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

    // Auction validation removed - no auctions
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
    // Simplified - no auctions
    this.logger.info("SDK order ready for processing (no auction)", {
      orderHash: order.orderHash,
    });
  }

  private createOrderEvent(type: OrderEvent["type"], data: any): OrderEvent {
    return {
      type,
      timestamp: Date.now(),
      data,
    };
  }
}
