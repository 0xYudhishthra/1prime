import { sepolia, arbitrumSepolia, optimismSepolia } from "viem/chains";

export const SUPPORTED_CHAINS = {
  11155111: { chain: sepolia, name: "Ethereum Sepolia" },
  421614: { chain: arbitrumSepolia, name: "Arbitrum Sepolia" },
  11155420: { chain: optimismSepolia, name: "Optimism Sepolia" },
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

export function getChainConfig(chainId: number) {
  const config = SUPPORTED_CHAINS[chainId as SupportedChainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}

export function getAllSupportedChains() {
  return Object.entries(SUPPORTED_CHAINS).map(([chainId, config]) => ({
    chainId: parseInt(chainId),
    ...config
  }));
}