import { ChainConfig } from "../types";

export const DEFAULT_EVM_CONFIG: Partial<ChainConfig> = {
  type: "evm",
  blockTime: 12, // Ethereum average
  finalityBlocks: 64, // ~12.8 minutes
  gasLimit: {
    htlcCreation: 200000,
    withdrawal: 150000,
    cancellation: 100000,
  },
};

export const DEFAULT_NEAR_CONFIG: Partial<ChainConfig> = {
  type: "near",
  blockTime: 1, // NEAR average
  finalityBlocks: 3, // NEAR finality is fast
  gasLimit: {
    htlcCreation: 300000000000000, // 300 TGas
    withdrawal: 200000000000000, // 200 TGas
    cancellation: 100000000000000, // 100 TGas
  },
};

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  // Ethereum Mainnet
  ethereum: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "1",
    name: "Ethereum",
    rpcUrl:
      process.env.ETHEREUM_RPC_URL ||
      "https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY",
    contractAddresses: {
      htlc:
        process.env.ETHEREUM_HTLC_ADDRESS ||
        "0x0000000000000000000000000000000000000000",
    },
  } as ChainConfig,

  // Base
  base: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "8453",
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    blockTime: 2, // Base is faster
    finalityBlocks: 100, // More blocks for same time
    contractAddresses: {
      htlc:
        process.env.BASE_HTLC_ADDRESS ||
        "0x0000000000000000000000000000000000000000",
    },
  } as ChainConfig,

  // Binance Smart Chain
  bsc: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "56",
    name: "BNB Smart Chain",
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/",
    blockTime: 3, // BSC is faster
    finalityBlocks: 256, // More confirmations needed
    contractAddresses: {
      htlc:
        process.env.BSC_HTLC_ADDRESS ||
        "0x0000000000000000000000000000000000000000",
    },
  } as ChainConfig,

  // Polygon
  polygon: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "137",
    name: "Polygon",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com/",
    blockTime: 2, // Polygon is fast
    finalityBlocks: 256,
    contractAddresses: {
      htlc:
        process.env.POLYGON_HTLC_ADDRESS ||
        "0x0000000000000000000000000000000000000000",
    },
  } as ChainConfig,

  // Arbitrum
  arbitrum: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "42161",
    name: "Arbitrum One",
    rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    blockTime: 1, // Arbitrum is very fast
    finalityBlocks: 20, // L2 finality considerations
    contractAddresses: {
      htlc:
        process.env.ARBITRUM_HTLC_ADDRESS ||
        "0x0000000000000000000000000000000000000000",
    },
  } as ChainConfig,

  // NEAR Protocol
  near: {
    ...DEFAULT_NEAR_CONFIG,
    chainId: "mainnet",
    name: "NEAR Protocol",
    rpcUrl: process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org",
    contractAddresses: {
      htlc: process.env.NEAR_HTLC_ADDRESS || "htlc.1prime.near",
    },
  } as ChainConfig,

  // NEAR Testnet (for development)
  "near-testnet": {
    ...DEFAULT_NEAR_CONFIG,
    chainId: "testnet",
    name: "NEAR Testnet",
    rpcUrl: process.env.NEAR_TESTNET_RPC_URL || "https://rpc.testnet.near.org",
    contractAddresses: {
      htlc: process.env.NEAR_TESTNET_HTLC_ADDRESS || "htlc.testnet",
    },
  } as ChainConfig,
};

export const SUPPORTED_CHAIN_PAIRS = [
  ["ethereum", "near"],
  ["base", "near"],
  ["bsc", "near"],
  ["polygon", "near"],
  ["arbitrum", "near"],
] as const;

export const getChainConfig = (chainId: string): ChainConfig => {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return config;
};

export const isValidChainPair = (
  sourceChain: string,
  destinationChain: string
): boolean => {
  return SUPPORTED_CHAIN_PAIRS.some(
    ([chain1, chain2]) =>
      (chain1 === sourceChain && chain2 === destinationChain) ||
      (chain1 === destinationChain && chain2 === sourceChain)
  );
};

export const getEvmChains = (): ChainConfig[] => {
  return Object.values(CHAIN_CONFIGS).filter(config => config.type === "evm");
};

export const getNearChains = (): ChainConfig[] => {
  return Object.values(CHAIN_CONFIGS).filter(config => config.type === "near");
};

export const createEvmChainConfig = (params: {
  chainId: string;
  name: string;
  rpcUrl: string;
  contractAddresses: ChainConfig["contractAddresses"];
  blockTime?: number;
  finalityBlocks?: number;
}): ChainConfig => {
  return {
    ...DEFAULT_EVM_CONFIG,
    ...params,
  } as ChainConfig;
};
