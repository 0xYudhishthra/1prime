import { jest, beforeAll, afterAll, beforeEach } from "@jest/globals";

// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.SUPPORTED_CHAINS = "ethereum,near";
process.env.MAX_ACTIVE_ORDERS = "10";
process.env.ENABLE_PARTIAL_FILLS = "true";

// Mock logger to reduce test output noise
jest.mock("winston", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn(),
  },
}));

// Mock node-cron to avoid actual scheduling during tests
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

// Global test timeout
jest.setTimeout(10000);

// Global test setup
beforeAll(() => {
  // Setup global test environment
});

afterAll(() => {
  // Cleanup global test environment
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

export const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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
  minBondTier: 1,
  requireBondHistory: false,
  signature: "0xsignature",
  nonce: "test-nonce",
  createdAt: Date.now(),
});

export const createMockResolver = () => ({
  address: "0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b",
  isKyc: true,
  bondAmount: "1000000",
  activeBond: "500000",
  reputation: 95,
  tier: 2,
  slashingHistory: 0,
  activeOrders: [],
  completedOrders: 25,
  lastActivity: Date.now(),
});
