import { OneInchApiService, OneInchApiConfig } from "../../services/1inch-api";
import { mockLogger } from "../setup";

describe("OneInchApiService", () => {
  let oneInchApi: OneInchApiService;
  const mockConfig: OneInchApiConfig = {
    apiKey: "test-api-key",
    baseUrl: "https://web3.1inch.dev",
    timeout: 10000,
  };

  beforeEach(() => {
    oneInchApi = new OneInchApiService(mockConfig, mockLogger);
  });

  describe("initialization", () => {
    it("should initialize with config", () => {
      expect(oneInchApi).toBeDefined();
    });

    it("should have cache methods", () => {
      expect(typeof oneInchApi.clearCache).toBe("function");
      expect(typeof oneInchApi.getCacheStats).toBe("function");
    });
  });

  describe("cache management", () => {
    it("should provide cache statistics", () => {
      const stats = oneInchApi.getCacheStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("keys");
      expect(Array.isArray(stats.keys)).toBe(true);
    });

    it("should clear cache", () => {
      oneInchApi.clearCache();
      const stats = oneInchApi.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it("should clear cache for specific chain", () => {
      oneInchApi.clearCache("ethereum");
      const stats = oneInchApi.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("chain support", () => {
    it("should check if chains are supported", () => {
      expect(oneInchApi.isChainSupported("1")).toBe(true); // Ethereum
      expect(oneInchApi.isChainSupported("8453")).toBe(true); // Base
      expect(oneInchApi.isChainSupported("42161")).toBe(true); // Arbitrum
      expect(oneInchApi.isChainSupported("137")).toBe(false); // Polygon (not supported)
      expect(oneInchApi.isChainSupported("999")).toBe(false); // Invalid chain
    });
  });

  describe("RPC methods", () => {
    it("should have getBlockNumber method", () => {
      expect(typeof oneInchApi.getBlockNumber).toBe("function");
    });

    it("should have getBalance method", () => {
      expect(typeof oneInchApi.getBalance).toBe("function");
    });

    it("should have getCode method", () => {
      expect(typeof oneInchApi.getCode).toBe("function");
    });

    it("should have getGasPrice method", () => {
      expect(typeof oneInchApi.getGasPrice).toBe("function");
    });

    it("should have estimateGas method", () => {
      expect(typeof oneInchApi.estimateGas).toBe("function");
    });

    it("should have sendRawTransaction method", () => {
      expect(typeof oneInchApi.sendRawTransaction).toBe("function");
    });
  });

  describe("error handling", () => {
    it("should reject unsupported chains", async () => {
      await expect(
        oneInchApi.getBlockNumber("137") // Polygon not supported
      ).rejects.toThrow("Chain 137 is not supported by 1inch Web3 RPC API");
    });

    it("should reject invalid chains", async () => {
      await expect(
        oneInchApi.getBalance(
          "999",
          "0x1234567890123456789012345678901234567890"
        )
      ).rejects.toThrow("Chain 999 is not supported by 1inch Web3 RPC API");
    });
  });
});
