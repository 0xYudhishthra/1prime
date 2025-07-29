import { PartialFillManager } from "../../services/partial-fill-manager";
import { mockLogger } from "../setup";
import { FusionOrderExtended } from "../../types";

describe("PartialFillManager", () => {
  let partialFillManager: PartialFillManager;

  beforeEach(() => {
    partialFillManager = new PartialFillManager(mockLogger);
  });

  describe("initializePartialFill", () => {
    const createPartialFillOrder = (
      fillParts: number = 4
    ): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000", // 100M tokens
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      allowPartialFills: true,
      allowMultipleFills: true,
      merkleSecretTree: {
        merkleRoot: "0xroot",
        merkleLeaves: Array.from(
          { length: fillParts + 1 },
          (_, i) => `0xleaf${i}`
        ),
        secretCount: fillParts + 1,
        fillParts,
      },
    });

    it("should initialize partial fill with N+1 secrets (whitepaper spec)", () => {
      const order = createPartialFillOrder(4); // 4 parts + 1 completion = 5 secrets

      const fillState = partialFillManager.initializePartialFill(order);

      expect(fillState.orderHash).toBe("0x123");
      expect(fillState.totalAmount).toBe("100000000");
      expect(fillState.fillParts).toBe(4);
      expect(fillState.availableSecrets).toEqual([1, 2, 3, 4, 5]); // 1-based indexing
      expect(fillState.secretsUsed).toEqual([]);
      expect(fillState.isCompleted).toBe(false);
    });

    it("should throw error for order without merkle tree", () => {
      const order = createPartialFillOrder();
      delete order.merkleSecretTree;

      expect(() => partialFillManager.initializePartialFill(order)).toThrow(
        "Order does not support partial fills - no Merkle tree"
      );
    });
  });

  describe("processPartialFill - Whitepaper Examples", () => {
    beforeEach(() => {
      const order = createPartialFillOrder(4);
      partialFillManager.initializePartialFill(order);
    });

    const createPartialFillOrder = (
      fillParts: number = 4
    ): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      allowPartialFills: true,
      allowMultipleFills: true,
      merkleSecretTree: {
        merkleRoot: "0xroot",
        merkleLeaves: Array.from(
          { length: fillParts + 1 },
          (_, i) => `0xleaf${i}`
        ),
        secretCount: fillParts + 1,
        fillParts,
      },
    });

    it("should handle 20% fill (whitepaper scenario 1)", async () => {
      // "first resolver intends to fill an order to 20%, they utilize the first secret"
      const result = await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver1",
        "20000000", // 20% of 100M
        1
      );

      expect(result.success).toBe(true);
      expect(result.secretIndex).toBe(1); // Uses secret 1 for 0-25% range

      const fillState = partialFillManager.getPartialFillState("0x123");
      expect(fillState?.fillPercentage).toBe(20);
      expect(fillState?.secretsUsed).toEqual([1]);
    });

    it("should handle 60% additional fill (whitepaper scenario 2)", async () => {
      // First fill 20%
      await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver1",
        "20000000",
        1
      );

      // "another resolver later wishes to increase the order fill by additional 60%"
      const result = await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver2",
        "60000000", // 60% more (total 80%)
        4
      );

      expect(result.success).toBe(true);
      expect(result.secretIndex).toBe(4); // Uses secret 4 for 75-100% range

      const fillState = partialFillManager.getPartialFillState("0x123");
      expect(fillState?.fillPercentage).toBe(80);
      expect(fillState?.secretsUsed).toEqual([1, 4]);
    });

    it("should handle completion fill (whitepaper scenario 3)", async () => {
      // Fill to 80% first
      await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver1",
        "20000000",
        1
      );
      await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver2",
        "60000000",
        4
      );

      // "the last resolver to fill the remaining 20% uses the fifth secret"
      const result = await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver3",
        "20000000", // Final 20%
        5 // Completion secret (N+1)
      );

      expect(result.success).toBe(true);
      expect(result.secretIndex).toBe(5); // Uses completion secret

      const fillState = partialFillManager.getPartialFillState("0x123");
      expect(fillState?.fillPercentage).toBe(100);
      expect(fillState?.isCompleted).toBe(true);
      expect(fillState?.secretsUsed).toEqual([1, 4, 5]);
    });

    it("should prevent double-spending of secrets", async () => {
      // Fill 30% which will use secret 2 (since it's in 25-50% range)
      await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver1",
        "30000000",
        2
      );

      // Try to fill another 20% which would also require secret 2 (since it's still in 25-50% range)
      // But secret 2 is already used, so this should fail
      const result = await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver2",
        "20000000",
        2
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Secret 2 already used or invalid");
    });

    it("should reject fills on completed orders", async () => {
      // Complete the order
      await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver1",
        "100000000",
        5
      );

      // Try to fill more
      const result = await partialFillManager.processPartialFill(
        "0x123",
        "0xResolver2",
        "10000000",
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Order already completed");
    });
  });

  describe("calculateRequiredSecretIndex", () => {
    it("should calculate correct secret indices for 4-part order", () => {
      // For 4 parts: 25% each
      // Secret 1: 0-25%, Secret 2: 25-50%, Secret 3: 50-75%, Secret 4: 75-100%, Secret 5: completion

      const order = createPartialFillOrder(4);
      partialFillManager.initializePartialFill(order);

      expect(
        partialFillManager.getNextAvailableSecret("0x123", "10000000")
      ).toBe(1); // 10% -> Secret 1
      expect(
        partialFillManager.getNextAvailableSecret("0x123", "25000000")
      ).toBe(1); // 25% -> Secret 1
      expect(
        partialFillManager.getNextAvailableSecret("0x123", "30000000")
      ).toBe(2); // 30% -> Secret 2
      expect(
        partialFillManager.getNextAvailableSecret("0x123", "75000000")
      ).toBe(3); // 75% -> Secret 3
      expect(
        partialFillManager.getNextAvailableSecret("0x123", "90000000")
      ).toBe(4); // 90% -> Secret 4
      expect(
        partialFillManager.getNextAvailableSecret("0x123", "100000000")
      ).toBe(5); // 100% -> Secret 5 (completion)
    });

    const createPartialFillOrder = (
      fillParts: number = 4
    ): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      allowPartialFills: true,
      allowMultipleFills: true,
      merkleSecretTree: {
        merkleRoot: "0xroot",
        merkleLeaves: Array.from(
          { length: fillParts + 1 },
          (_, i) => `0xleaf${i}`
        ),
        secretCount: fillParts + 1,
        fillParts,
      },
    });
  });

  describe("supportsPartialFills", () => {
    it("should return true for orders with merkle tree and partial fills enabled", () => {
      const order = createPartialFillOrder();
      expect(partialFillManager.supportsPartialFills(order)).toBe(true);
    });

    it("should return false for orders without partial fills enabled", () => {
      const order = createPartialFillOrder();
      order.allowPartialFills = false;
      expect(partialFillManager.supportsPartialFills(order)).toBe(false);
    });

    it("should return false for orders without merkle tree", () => {
      const order = createPartialFillOrder();
      delete order.merkleSecretTree;
      expect(partialFillManager.supportsPartialFills(order)).toBe(false);
    });

    const createPartialFillOrder = (
      fillParts: number = 4
    ): FusionOrderExtended => ({
      orderHash: "0x123",
      maker: "0xmaker",
      sourceChain: "ethereum",
      destinationChain: "near",
      sourceToken: "ETH",
      destinationToken: "NEAR",
      sourceAmount: "100000000",
      destinationAmount: "1000000000",
      secretHash: "0xsecret",
      timeout: Date.now() + 3600000,
      auctionStartTime: Date.now(),
      auctionDuration: 120000,
      initialRateBump: 1000,
      signature: "0xsig",
      nonce: "nonce1",
      createdAt: Date.now(),
      allowPartialFills: true,
      allowMultipleFills: true,
      merkleSecretTree: {
        merkleRoot: "0xroot",
        merkleLeaves: Array.from(
          { length: fillParts + 1 },
          (_, i) => `0xleaf${i}`
        ),
        secretCount: fillParts + 1,
        fillParts,
      },
    });
  });
});

const createPartialFillOrder = (
  fillParts: number = 4
): FusionOrderExtended => ({
  orderHash: "0x123",
  maker: "0xmaker",
  sourceChain: "ethereum",
  destinationChain: "near",
  sourceToken: "ETH",
  destinationToken: "NEAR",
  sourceAmount: "100000000",
  destinationAmount: "1000000000",
  secretHash: "0xsecret",
  timeout: Date.now() + 3600000,
  auctionStartTime: Date.now(),
  auctionDuration: 120000,
  initialRateBump: 1000,
  signature: "0xsig",
  nonce: "nonce1",
  createdAt: Date.now(),
  allowPartialFills: true,
  allowMultipleFills: true,
  merkleSecretTree: {
    merkleRoot: "0xroot",
    merkleLeaves: Array.from({ length: fillParts + 1 }, (_, i) => `0xleaf${i}`),
    secretCount: fillParts + 1,
    fillParts,
  },
});
