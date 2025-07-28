// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.SUPPORTED_CHAINS = "ethereum,near";
process.env.MAX_ACTIVE_ORDERS = "10";
process.env.ENABLE_PARTIAL_FILLS = "true";

// Mock logger for testing
export const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export const createMockOrder = () => ({
  orderHash:
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  maker: "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b",
  sourceChain: "ethereum",
  destinationChain: "near",
  sourceToken: "ETH",
  destinationToken: "NEAR",
  sourceAmount: "1.0",
  destinationAmount: "100.0",
  secretHash:
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  timeout: Date.now() + 3600000, // 1 hour from now
  auctionStartTime: Date.now(),
  auctionDuration: 120000, // 2 minutes
  initialRateBump: 1000, // 10%
  signature: "0xsignature",
  nonce: "test-nonce",
  createdAt: Date.now(),
});

export const createMockResolver = () => ({
  address: "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b",
  isKyc: true,
  reputation: 95,
  completedOrders: 25,
  lastActivity: Date.now(),
});
