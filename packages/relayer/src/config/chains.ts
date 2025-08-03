import { ChainConfig } from "../types";

export const DEFAULT_EVM_CONFIG: Partial<ChainConfig> = {
  type: "evm",
  blockTime: 12, // Ethereum average
  finalityBlocks: 64, // ~12.8 minutes
  gasLimit: {
    withdrawal: 150000,
    cancellation: 100000,
  },
};

export const DEFAULT_NEAR_CONFIG: Partial<ChainConfig> = {
  type: "near",
  blockTime: 1, // NEAR average
  finalityBlocks: 3, // NEAR finality is fast
  gasLimit: {
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
  } as ChainConfig,

  // Base
  base: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "8453",
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    blockTime: 2, // Base is faster
    finalityBlocks: 100, // More blocks for same time
  } as ChainConfig,

  // Binance Smart Chain
  bsc: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "56",
    name: "BNB Smart Chain",
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/",
    blockTime: 3, // BSC is faster
    finalityBlocks: 256, // More confirmations needed
  } as ChainConfig,

  // Polygon
  polygon: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "137",
    name: "Polygon",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com/",
    blockTime: 2, // Polygon is fast
    finalityBlocks: 256,
  } as ChainConfig,

  // Arbitrum
  arbitrum: {
    ...DEFAULT_EVM_CONFIG,
    chainId: "42161",
    name: "Arbitrum One",
    rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    blockTime: 1, // Arbitrum is very fast
    finalityBlocks: 20, // L2 finality considerations
  } as ChainConfig,

  // NEAR Protocol
  near: {
    ...DEFAULT_NEAR_CONFIG,
    chainId: "mainnet",
    name: "NEAR Protocol",
    rpcUrl: process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org",
    escrowFactoryAddress: "0x0000000000000000000000000000000000000000",
  } as ChainConfig,

  // Ethereum Sepolia Testnet
  "eth-sepolia": {
    ...DEFAULT_EVM_CONFIG,
    chainId: "11155111",
    name: "Sepolia Testnet",
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
    escrowFactoryAddress: "0x128ce802AB730FbB360b784CA8C16dD73147649c",
  } as ChainConfig,

  // NEAR Testnet (for development)
  "near-testnet": {
    ...DEFAULT_NEAR_CONFIG,
    chainId: "398",
    name: "NEAR Testnet",
    rpcUrl: process.env.NEAR_TESTNET_RPC_URL || "https://rpc.testnet.near.org",
    escrowFactoryAddress: "0x0000000000000000000000000000000000000000",
  } as ChainConfig,
};

export const SUPPORTED_CHAIN_PAIRS = [
  ["ethereum", "near"],
  ["base", "near"],
  ["bsc", "near"],
  ["polygon", "near"],
  ["arbitrum", "near"],
  // Testnet pairs
  ["eth-sepolia", "near-testnet"],
] as const;

export const getChainConfig = (chainId: string): ChainConfig => {
  console.log("chainId", chainId);
  const config = CHAIN_CONFIGS[chainId];

  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return config;
};

export const getEscrowFactoryAddress = (chainId: string): string => {
  const config = getChainConfig(chainId);
  if (!config.escrowFactoryAddress) {
    throw new Error(
      `Escrow factory address not configured for chain: ${chainId}. ` +
        `Please add escrowFactoryAddress to the chain configuration.`
    );
  }
  return config.escrowFactoryAddress;
};

/**
 * Convert chain ID to chain name
 */
export const getChainNameFromChainId = (chainId: string): string | null => {
  console.log("chainId", chainId);
  const config = Object.entries(CHAIN_CONFIGS).find(
    ([_, config]) => config.chainId === chainId
  );
  return config ? config[0] : null;
};

export const isValidChainPair = (
  sourceChain: string,
  destinationChain: string
): boolean => {
  console.log("sourceChain", sourceChain);
  console.log("destinationChain", destinationChain);
  console.log("SUPPORTED_CHAIN_PAIRS", SUPPORTED_CHAIN_PAIRS);

  // Try to convert chain IDs to chain names if needed
  let srcChainName = sourceChain;
  let dstChainName = destinationChain;

  // Check if sourceChain is a numeric chain ID
  if (/^\d+$/.test(sourceChain)) {
    const convertedName = getChainNameFromChainId(sourceChain);
    if (convertedName) {
      srcChainName = convertedName;
      console.log(
        `Converted source chain ID ${sourceChain} to name ${srcChainName}`
      );
    }
  }

  // Check if destinationChain is a numeric chain ID
  if (/^\d+$/.test(destinationChain)) {
    const convertedName = getChainNameFromChainId(destinationChain);
    if (convertedName) {
      dstChainName = convertedName;
      console.log(
        `Converted destination chain ID ${destinationChain} to name ${dstChainName}`
      );
    }
  }

  return SUPPORTED_CHAIN_PAIRS.some(
    ([chain1, chain2]) =>
      (chain1 === srcChainName && chain2 === dstChainName) ||
      (chain1 === dstChainName && chain2 === srcChainName)
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
  blockTime?: number;
  finalityBlocks?: number;
}): ChainConfig => {
  return {
    ...DEFAULT_EVM_CONFIG,
    ...params,
  } as ChainConfig;
};
