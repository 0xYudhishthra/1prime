import { EventEmitter } from "events";
import type { Logger } from "winston";
import {
  FusionOrder,
  DutchAuctionState,
  OrderStatus,
  OrderEvent,
  TimelockPhase,
  RelayerStatus,
  CreateOrderRequest,
  ResolverBidRequest,
} from "../types";
import { createHash } from "crypto";

export class OrderManager extends EventEmitter {
  private logger: Logger;
  private orders: Map<string, FusionOrder> = new Map();
  private orderStatuses: Map<string, OrderStatus> = new Map();
  private auctions: Map<string, DutchAuctionState> = new Map();
  private resolvers: Map<string, RelayerStatus> = new Map();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  async createOrder(
    request: CreateOrderRequest,
    maker: string
  ): Promise<FusionOrder> {
    try {
      const orderHash = this.generateOrderHash(request, maker);
      const now = Date.now();

      const order: FusionOrder = {
        orderHash,
        maker,
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
        sourceToken: request.sourceToken,
        destinationToken: request.destinationToken,
        sourceAmount: request.sourceAmount,
        destinationAmount: request.destinationAmount,
        secretHash: this.generateSecretHash(request.nonce, maker),
        timeout: request.timeout,
        auctionStartTime: now,
        auctionDuration: request.auctionDuration || 120000, // 2 minutes default
        initialRateBump: request.initialRateBump || 1000, // 10% default
        signature: request.signature,
        nonce: request.nonce,
        createdAt: now,
      };

      // Validate order
      this.validateOrder(order);

      // Store order
      this.orders.set(orderHash, order);

      // Initialize order status
      const orderStatus: OrderStatus = {
        orderHash,
        phase: "announcement",
        isCompleted: false,
        events: [this.createOrderEvent("order_created", { order })],
      };
      this.orderStatuses.set(orderHash, orderStatus);

      // Start Dutch auction
      this.startDutchAuction(order);

      this.logger.info("Order created", { orderHash, maker });
      this.emit("order_created", order);

      return order;
    } catch (error) {
      this.logger.error("Failed to create order", {
        error: (error as Error).message,
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
    const timeSinceStart = Date.now() - auction.startTime;
    const progress = Math.min(timeSinceStart / auction.duration, 1);

    // Linear decay from initialRateBump to 0
    const currentRate = auction.initialRateBump * (1 - progress);
    return Math.max(currentRate, 0);
  }

  private isBidProfitable(
    order: FusionOrder,
    currentRate: number,
    gasEstimate: number
  ): boolean {
    // Simplified profitability check - in production this would use real gas prices
    // and token prices from oracles
    const baseFee = 20e9; // 20 gwei
    const gasCost = gasEstimate * baseFee;
    const rateBump = currentRate / 10000; // Convert basis points to decimal

    // Order is profitable if rate adjustment covers gas costs plus minimum profit
    const rateAdjustment = parseFloat(order.destinationAmount) * rateBump;
    const minProfit = gasCost * 1.1; // 10% minimum profit margin

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

  private generateOrderHash(
    request: CreateOrderRequest,
    maker: string
  ): string {
    const data = JSON.stringify({
      maker,
      sourceChain: request.sourceChain,
      destinationChain: request.destinationChain,
      sourceToken: request.sourceToken,
      destinationToken: request.destinationToken,
      sourceAmount: request.sourceAmount,
      destinationAmount: request.destinationAmount,
      timeout: request.timeout,
      nonce: request.nonce,
    });

    return createHash("sha256").update(data).digest("hex");
  }

  private generateSecretHash(nonce: string, maker: string): string {
    const secret = createHash("sha256")
      .update(`${nonce}-${maker}-${Date.now()}`)
      .digest("hex");
    return createHash("sha256").update(secret).digest("hex");
  }

  private createOrderEvent(type: OrderEvent["type"], data: any): OrderEvent {
    return {
      type,
      timestamp: Date.now(),
      data,
    };
  }
}
