import { OrderManager } from "../../services/order-manager";
import { mockLogger, createMockOrder, createMockResolver } from "../setup";
import {
  CreateOrderRequest,
  ResolverBidRequest,
  FusionOrderExtended,
  RelayerStatus,
} from "../../types";

describe("OrderManager", () => {
  let orderManager: OrderManager;

  beforeEach(() => {
    orderManager = new OrderManager(mockLogger);
  });

  describe("createOrder", () => {
    const validOrderRequest: CreateOrderRequest = {
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "1.0",
      destinationAmount: "100.0",
      timeout: Date.now() + 3600000,
      signature: "0xsignature",
      nonce: "test-nonce",
    };

    it("should create order successfully", async () => {
      const maker = "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b";
      const order = await orderManager.createOrder(validOrderRequest, maker);

      expect(order.maker).toBe(maker);
      expect(order.sourceChain).toBe(validOrderRequest.sourceChain);
      expect(order.destinationChain).toBe(validOrderRequest.destinationChain);
      expect(order.orderHash).toBeDefined();
      expect(order.auctionStartTime).toBeDefined();
    });

    it("should fail with invalid timeout", async () => {
      const invalidRequest = {
        ...validOrderRequest,
        timeout: Date.now() - 1000, // Past timestamp
      };

      await expect(
        orderManager.createOrder(
          invalidRequest,
          "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
        )
      ).rejects.toThrow("timeout must be in the future");
    });

    it("should fail with invalid amounts", async () => {
      const invalidRequest = {
        ...validOrderRequest,
        sourceAmount: "0",
      };

      await expect(
        orderManager.createOrder(
          invalidRequest,
          "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
        )
      ).rejects.toThrow("amounts must be positive");
    });

    it("should fail with invalid auction duration", async () => {
      const invalidRequest = {
        ...validOrderRequest,
        auctionDuration: 10000, // Too short
      };

      await expect(
        orderManager.createOrder(
          invalidRequest,
          "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
        )
      ).rejects.toThrow("auction duration must be between 30s and 5min");
    });

    it("should start Dutch auction automatically", async () => {
      const order = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      const auction = orderManager.getAuction(order.orderHash);

      expect(auction).toBeDefined();
      expect(auction?.isActive).toBe(true);
      expect(auction?.initialRateBump).toBe(1000); // Default value
    });
  });

  describe("submitResolverBid", () => {
    let orderHash: string;
    const resolver = createMockResolver();

    beforeEach(async () => {
      const validOrderRequest: CreateOrderRequest = {
        sourceChain: "ethereum",
        destinationChain: "near",
        sourceToken: "ETH",
        destinationToken: "NEAR",
        sourceAmount: "1.0",
        destinationAmount: "100.0",
        timeout: Date.now() + 3600000,
        signature: "0xsignature",
        nonce: "test-nonce",
      };

      const order = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      orderHash = order.orderHash;
      orderManager.registerResolver(resolver);
    });

    it("should accept valid resolver bid", async () => {
      const bid: ResolverBidRequest = {
        orderHash,
        resolver: resolver.address,
        estimatedGas: 10000, // Lower gas estimate to make bid more profitable
        signature: "0xsignature",
      };

      const accepted = await orderManager.submitResolverBid(bid);
      expect(accepted).toBe(true);

      const auction = orderManager.getAuction(orderHash);
      expect(auction?.isActive).toBe(false);
      expect(auction?.winner).toBe(resolver.address);
    });

    it("should reject bid for non-existent order", async () => {
      const bid: ResolverBidRequest = {
        orderHash: "nonexistent",
        resolver: resolver.address,
        estimatedGas: 150000,
        signature: "0xsignature",
      };

      await expect(orderManager.submitResolverBid(bid)).rejects.toThrow(
        "Order not found"
      );
    });

    it("should reject bid from unregistered resolver", async () => {
      const bid: ResolverBidRequest = {
        orderHash,
        resolver: "0xunregistered",
        estimatedGas: 150000,
        signature: "0xsignature",
      };

      await expect(orderManager.submitResolverBid(bid)).rejects.toThrow(
        "Resolver not registered"
      );
    });

    it("should reject bid if resolver is not KYC approved", async () => {
      // Create a non-KYC resolver
      const nonKycResolver: RelayerStatus = {
        address: "0xnonkyc",
        isKyc: false,
        reputation: 50,
        completedOrders: 10,
        lastActivity: Date.now(),
      };
      orderManager.registerResolver(nonKycResolver);

      const bid: ResolverBidRequest = {
        orderHash,
        resolver: nonKycResolver.address,
        estimatedGas: 150000,
        signature: "0xsignature",
      };

      await expect(orderManager.submitResolverBid(bid)).rejects.toThrow(
        "Resolver must be KYC approved to participate"
      );
    });
  });

  describe("getOrder", () => {
    it("should return existing order", async () => {
      const validOrderRequest: CreateOrderRequest = {
        sourceChain: "ethereum",
        destinationChain: "near",
        sourceToken: "ETH",
        destinationToken: "NEAR",
        sourceAmount: "1.0",
        destinationAmount: "100.0",
        timeout: Date.now() + 3600000,
        signature: "0xsignature",
        nonce: "test-nonce",
      };

      const order = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      const retrievedOrder = orderManager.getOrder(order.orderHash);

      expect(retrievedOrder).toEqual(order);
    });

    it("should return undefined for non-existent order", () => {
      const retrievedOrder = orderManager.getOrder("nonexistent");
      expect(retrievedOrder).toBeUndefined();
    });
  });

  describe("getActiveOrders", () => {
    it("should return only active orders", async () => {
      const validOrderRequest: CreateOrderRequest = {
        sourceChain: "ethereum",
        destinationChain: "near",
        sourceToken: "ETH",
        destinationToken: "NEAR",
        sourceAmount: "1.0",
        destinationAmount: "100.0",
        timeout: Date.now() + 3600000,
        signature: "0xsignature",
        nonce: "test-nonce",
      };

      // Create two orders
      const order1 = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      const order2Request = { ...validOrderRequest, nonce: "test-nonce-2" };
      const order2 = await orderManager.createOrder(
        order2Request,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );

      // Complete one order
      await orderManager.completeOrder(order1.orderHash, "secret");

      const activeOrders = orderManager.getActiveOrders();
      expect(activeOrders).toHaveLength(1);
      expect(activeOrders[0].orderHash).toBe(order2.orderHash);
    });

    it("should return empty array when no active orders", () => {
      const activeOrders = orderManager.getActiveOrders();
      expect(activeOrders).toHaveLength(0);
    });
  });

  describe("updateOrderPhase", () => {
    let orderHash: string;

    beforeEach(async () => {
      const validOrderRequest: CreateOrderRequest = {
        sourceChain: "ethereum",
        destinationChain: "near",
        sourceToken: "ETH",
        destinationToken: "NEAR",
        sourceAmount: "1.0",
        destinationAmount: "100.0",
        timeout: Date.now() + 3600000,
        signature: "0xsignature",
        nonce: "test-nonce",
      };

      const order = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      orderHash = order.orderHash;
    });

    it("should update order phase successfully", async () => {
      await orderManager.updateOrderPhase(orderHash, "deposit");

      const orderStatus = orderManager.getOrderStatus(orderHash);
      expect(orderStatus?.phase).toBe("deposit");
    });

    it("should fail for non-existent order", async () => {
      await expect(
        orderManager.updateOrderPhase("nonexistent", "deposit")
      ).rejects.toThrow("Order not found");
    });
  });

  describe("cancelOrder", () => {
    let orderHash: string;

    beforeEach(async () => {
      const validOrderRequest: CreateOrderRequest = {
        sourceChain: "ethereum",
        destinationChain: "near",
        sourceToken: "ETH",
        destinationToken: "NEAR",
        sourceAmount: "1.0",
        destinationAmount: "100.0",
        timeout: Date.now() + 3600000,
        signature: "0xsignature",
        nonce: "test-nonce",
      };

      const order = await orderManager.createOrder(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
      orderHash = order.orderHash;
    });

    it("should cancel order successfully", async () => {
      const reason = "Test cancellation";
      await orderManager.cancelOrder(orderHash, reason);

      const orderStatus = orderManager.getOrderStatus(orderHash);
      expect(orderStatus?.phase).toBe("recovery");
      expect(orderStatus?.error).toBe(reason);
    });

    it("should stop auction when cancelling order", async () => {
      await orderManager.cancelOrder(orderHash, "Test cancellation");

      const auction = orderManager.getAuction(orderHash);
      expect(auction?.isActive).toBe(false);
    });
  });

  describe("registerResolver", () => {
    it("should register resolver successfully", () => {
      const resolver = createMockResolver();

      expect(() => {
        orderManager.registerResolver(resolver);
      }).not.toThrow();

      // Verify resolver can be used in bids
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Resolver registered",
        expect.objectContaining({
          address: resolver.address,
          reputation: resolver.reputation,
        })
      );
    });
  });
});
