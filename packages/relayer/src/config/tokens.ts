// Token configuration for cross-chain swaps
// Maps token symbols to their addresses on different chains

export interface TokenConfig {
  symbol: string;
  name: string;
  decimals: number;
  addresses: {
    [chainId: string]: string;
  };
}

export const TOKEN_CONFIGS: Record<string, TokenConfig> = {
  usdc: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    addresses: {
      ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Chain ID alias for ethereum
      "eth-sepolia": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "11155111": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Chain ID alias for eth-sepolia
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Chain ID alias for base
      bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      "56": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // Chain ID alias for bsc
      polygon: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      "137": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Chain ID alias for polygon
      arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Chain ID alias for arbitrum
      near: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
      "397": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af", // Chain ID alias for near
      "near-testnet":
        "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
      "398": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af", // Chain ID alias for near-testnet
    },
  },
  usdt: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    addresses: {
      ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "1": "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Chain ID alias for ethereum
      "eth-sepolia": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "11155111": "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Chain ID alias for eth-sepolia
      base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
      "8453": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", // Chain ID alias for base
      bsc: "0x55d398326f99059fF775485246999027B3197955",
      "56": "0x55d398326f99059fF775485246999027B3197955", // Chain ID alias for bsc
      polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      "137": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // Chain ID alias for polygon
      arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      "42161": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Chain ID alias for arbitrum
      near: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      "397": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", // Chain ID alias for near
      "near-testnet":
        "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      "398": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", // Chain ID alias for near-testnet
    },
  },
  weth: {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    addresses: {
      ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Chain ID alias for ethereum
      "eth-sepolia": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      "11155111": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // Chain ID alias for eth-sepolia
      base: "0x4200000000000000000000000000000000000006",
      "8453": "0x4200000000000000000000000000000000000006", // Chain ID alias for base
      bsc: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "56": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", // Chain ID alias for bsc
      polygon: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      "137": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // Chain ID alias for polygon
      arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "42161": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // Chain ID alias for arbitrum
      near: "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96",
      "397": "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96", // Chain ID alias for near
      "near-testnet":
        "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96",
      "398": "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96", // Chain ID alias for near-testnet
    },
  },
  eth: {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    addresses: {
      ethereum: "0x0000000000000000000000000000000000000000", // Native ETH
      "1": "0x0000000000000000000000000000000000000000", // Chain ID alias for ethereum
      "eth-sepolia": "0x0000000000000000000000000000000000000000", // Native ETH
      "11155111": "0x0000000000000000000000000000000000000000", // Chain ID alias for eth-sepolia
      base: "0x0000000000000000000000000000000000000000", // Native ETH
      "8453": "0x0000000000000000000000000000000000000000", // Chain ID alias for base
      // ETH on other chains is typically wrapped
      bsc: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", // Wrapped ETH
      "56": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", // Chain ID alias for bsc
      polygon: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // Wrapped ETH
      "137": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // Chain ID alias for polygon
      arbitrum: "0x0000000000000000000000000000000000000000", // Native ETH on Arbitrum
      "42161": "0x0000000000000000000000000000000000000000", // Chain ID alias for arbitrum
      near: "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96",
      "397": "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96", // Chain ID alias for near
      "near-testnet":
        "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96",
      "398": "c9bdc319c7c02de7b85823a49ce63c48db7f37a7e40e0e6e89c70a1b78e46b96", // Chain ID alias for near-testnet
    },
  },
};

// Helper function to get token address by symbol and chain
export function getTokenAddress(tokenSymbol: string, chainId: string): string {
  const tokenConfig = TOKEN_CONFIGS[tokenSymbol.toLowerCase()];
  if (!tokenConfig) {
    throw new Error(`Token symbol '${tokenSymbol}' not supported`);
  }

  const address = tokenConfig.addresses[chainId];
  if (!address) {
    throw new Error(
      `Token '${tokenSymbol}' not available on chain '${chainId}'`
    );
  }

  return address;
}

// Helper function to get token decimals
export function getTokenDecimals(tokenSymbol: string): number {
  const tokenConfig = TOKEN_CONFIGS[tokenSymbol.toLowerCase()];
  if (!tokenConfig) {
    throw new Error(`Token symbol '${tokenSymbol}' not supported`);
  }
  return tokenConfig.decimals;
}

// Helper function to get all supported tokens
export function getSupportedTokens(): string[] {
  return Object.keys(TOKEN_CONFIGS);
}

// Helper function to check if a token is supported on a chain
export function isTokenSupportedOnChain(
  tokenSymbol: string,
  chainId: string
): boolean {
  const tokenConfig = TOKEN_CONFIGS[tokenSymbol.toLowerCase()];
  console.log("tokenConfig", tokenConfig);
  console.log("chainId", chainId);
  console.log(tokenConfig.addresses[chainId]);
  return tokenConfig && !!tokenConfig.addresses[chainId];
}
