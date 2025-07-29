import request from "supertest";
import express from "express";
import { createRelayerRoutes } from "../../api/routes";
import { RelayerService } from "../../services/relayer";
import { mockLogger, createMockOrder, createMockResolver } from "../setup";

// Mock the RelayerService
jest.mock("../../services/relayer");

describe("Relayer API Routes", () => {
  let app: express.Application;
  let mockRelayerService: jest.Mocked<RelayerService>;

  beforeEach(() => {
    // Create mock relayer service
    mockRelayerService = {
      initialize: jest.fn(),
      createOrder: jest.fn(),
      submitResolverBid: jest.fn(),
      requestSecretReveal: jest.fn(),
      getOrderStatus: jest.fn(),
      getActiveOrders: jest.fn(),
      registerResolver: jest.fn(),
      getHealthStatus: jest.fn(),
      shutdown: jest.fn(),
    } as any;

    // Setup Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api/v1", createRelayerRoutes(mockRelayerService, mockLogger));

    // Add 404 handler for unknown endpoints
    app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        error: "Endpoint not found",
        timestamp: Date.now(),
      });
    });
  });

  describe("GET /health", () => {
    it("should return healthy status", async () => {
      const healthStatus = {
        status: "healthy" as const,
        timestamp: Date.now(),
        version: "1.0.0",
        chains: {
          ethereum: { connected: true, blockNumber: 18500000, latency: 50 },
          near: { connected: true, blockNumber: 105000000, latency: 30 },
        },
        activeOrders: 5,
        completedOrders: 100,
        errorRate: 0.02,
      };

      mockRelayerService.getHealthStatus.mockResolvedValue(healthStatus);

      const response = await request(app).get("/api/v1/health").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(healthStatus);
    });

    it("should return unhealthy status with 503", async () => {
      const healthStatus = {
        status: "unhealthy" as const,
        timestamp: Date.now(),
        version: "1.0.0",
        chains: {
          ethereum: { connected: false, blockNumber: 0, latency: 0 },
          near: { connected: true, blockNumber: 105000000, latency: 30 },
        },
        activeOrders: 2,
        completedOrders: 50,
        errorRate: 0.15,
      };

      mockRelayerService.getHealthStatus.mockResolvedValue(healthStatus);

      const response = await request(app).get("/api/v1/health").expect(503);

      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /orders", () => {
    const validOrderRequest = {
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
      const mockOrder = createMockOrder();
      const mockOrderStatus = {
        orderHash: mockOrder.orderHash,
        phase: "announcement" as const,
        isCompleted: false,
        events: [],
      };

      mockRelayerService.createOrder.mockResolvedValue(mockOrderStatus);

      const response = await request(app)
        .post("/api/v1/orders")
        .set("x-maker-address", "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b")
        .send(validOrderRequest)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderHash).toBe(mockOrder.orderHash);
      expect(mockRelayerService.createOrder).toHaveBeenCalledWith(
        validOrderRequest,
        "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b"
      );
    });

    it("should fail without maker address header", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .send(validOrderRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Missing x-maker-address header");
    });

    it("should fail with invalid timeout", async () => {
      const invalidRequest = {
        ...validOrderRequest,
        timeout: Date.now() - 1000, // Past timestamp
      };

      const response = await request(app)
        .post("/api/v1/orders")
        .set("x-maker-address", "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b")
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should fail with missing required fields", async () => {
      const invalidRequest = {
        sourceChain: "ethereum",
        // Missing other required fields
      };

      const response = await request(app)
        .post("/api/v1/orders")
        .set("x-maker-address", "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b")
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /orders/:orderHash", () => {
    const validOrderHash =
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    it("should return order status", async () => {
      const mockOrderStatus = {
        orderHash: validOrderHash,
        phase: "withdrawal" as const,
        isCompleted: false,
        events: [],
      };

      mockRelayerService.getOrderStatus.mockResolvedValue(mockOrderStatus);

      const response = await request(app)
        .get(`/api/v1/orders/${validOrderHash}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderHash).toBe(validOrderHash);
    });

    it("should return 404 for non-existent order", async () => {
      mockRelayerService.getOrderStatus.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/v1/orders/${validOrderHash}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Order not found");
    });

    it("should fail with invalid order hash format", async () => {
      const response = await request(app)
        .get("/api/v1/orders/invalid-hash")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid order hash format");
    });
  });

  describe("GET /orders", () => {
    it("should return active orders", async () => {
      const mockOrders = [createMockOrder(), createMockOrder()];
      mockRelayerService.getActiveOrders.mockResolvedValue(mockOrders);

      const response = await request(app).get("/api/v1/orders").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it("should return empty array when no active orders", async () => {
      mockRelayerService.getActiveOrders.mockResolvedValue([]);

      const response = await request(app).get("/api/v1/orders").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe("POST /bids", () => {
    const validBidRequest = {
      orderHash:
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      resolver: "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b",
      estimatedGas: 150000,
      signature: "0xsignature",
    };

    it("should accept valid bid", async () => {
      mockRelayerService.submitResolverBid.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/v1/bids")
        .send(validBidRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accepted).toBe(true);
    });

    it("should reject invalid bid", async () => {
      mockRelayerService.submitResolverBid.mockResolvedValue(false);

      const response = await request(app)
        .post("/api/v1/bids")
        .send(validBidRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accepted).toBe(false);
    });

    it("should fail with invalid order hash", async () => {
      const invalidRequest = {
        ...validBidRequest,
        orderHash: "invalid-hash",
      };

      const response = await request(app)
        .post("/api/v1/bids")
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /secrets/reveal", () => {
    const validRevealRequest = {
      orderHash:
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      secret: "secret-value",
      proof: "proof-string",
      signature: "0xsignature",
    };

    it("should reveal secret when conditions are met", async () => {
      const mockSecret = "revealed-secret-value";
      mockRelayerService.requestSecretReveal.mockResolvedValue(mockSecret);

      const response = await request(app)
        .post("/api/v1/secrets/reveal")
        .send(validRevealRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.secret).toBe(mockSecret);
    });

    it("should return 403 when conditions not met", async () => {
      mockRelayerService.requestSecretReveal.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/v1/secrets/reveal")
        .send(validRevealRequest)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Secret reveal conditions not met");
    });
  });

  describe("POST /resolvers", () => {
    it("should register resolver successfully", async () => {
      const mockResolver = createMockResolver();
      mockRelayerService.registerResolver.mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/v1/resolvers")
        .send(mockResolver)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain("registered successfully");
    });

    it("should fail with invalid resolver data", async () => {
      const invalidResolver = {
        address: "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b",
        // Missing required fields
      };

      const response = await request(app)
        .post("/api/v1/resolvers")
        .send(invalidResolver)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /auctions/:orderHash", () => {
    const validOrderHash =
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    it("should return auction information", async () => {
      const mockOrderStatus = {
        orderHash: validOrderHash,
        phase: "announcement" as const,
        auction: {
          orderHash: validOrderHash,
          startTime: Date.now(),
          duration: 120000,
          initialRateBump: 1000,
          currentRate: 800,
          isActive: true,
          participatingResolvers: [],
        },
        isCompleted: false,
        events: [],
      };

      mockRelayerService.getOrderStatus.mockResolvedValue(mockOrderStatus);

      const response = await request(app)
        .get(`/api/v1/auctions/${validOrderHash}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderHash).toBe(validOrderHash);
      expect(response.body.data.isActive).toBe(true);
    });

    it("should return 404 when auction not found", async () => {
      mockRelayerService.getOrderStatus.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/v1/auctions/${validOrderHash}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Auction not found");
    });
  });

  describe("GET /stats", () => {
    it("should return system statistics", async () => {
      const mockHealthStatus = {
        status: "healthy" as const,
        timestamp: Date.now(),
        version: "1.0.0",
        chains: {
          ethereum: { connected: true, blockNumber: 18500000, latency: 50 },
          near: { connected: true, blockNumber: 105000000, latency: 30 },
        },
        activeOrders: 5,
        completedOrders: 100,
        errorRate: 0.02,
      };

      const mockActiveOrders = [createMockOrder(), createMockOrder()];

      mockRelayerService.getHealthStatus.mockResolvedValue(mockHealthStatus);
      mockRelayerService.getActiveOrders.mockResolvedValue(mockActiveOrders);

      const response = await request(app).get("/api/v1/stats").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.activeOrders).toBe(2);
      expect(response.body.data.completedOrders).toBe(100);
      expect(response.body.data.errorRate).toBe(0.02);
    });
  });

  describe("GET /ws-info", () => {
    it("should return WebSocket information", async () => {
      const response = await request(app).get("/api/v1/ws-info").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.websocket.endpoint).toBe("/ws");
      expect(response.body.data.supportedEvents).toContain("order_created");
      expect(response.body.data.supportedEvents).toContain("auction_won");
    });
  });

  describe("Error handling", () => {
    it("should handle service errors gracefully", async () => {
      mockRelayerService.getActiveOrders.mockRejectedValue(
        new Error("Service unavailable")
      );

      const response = await request(app).get("/api/v1/orders").expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Internal server error");
    });

    it("should return 404 for unknown endpoints", async () => {
      const response = await request(app)
        .get("/api/v1/definitely-does-not-exist-12345")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Endpoint not found");
    });
  });
});
