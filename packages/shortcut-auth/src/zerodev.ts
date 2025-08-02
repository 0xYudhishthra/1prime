import {
  createKernelAccount,
  createZeroDevPaymasterClient,
  createKernelAccountClient,
} from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { toMultiChainECDSAValidator } from '@zerodev/multi-chain-ecdsa-validator';

import {
  http,
  Hex,
  createPublicClient,
  zeroAddress,
  parseEther,
  formatEther,
  Chain,
  formatUnits,
  getAddress,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import { EntryPointVersion } from 'viem/account-abstraction';
import { GetKernelVersion, Signer } from '@zerodev/sdk/types';
import { SUPPORTED_CHAINS, getAllSupportedChains } from './chains';

// ERC-20 ABI for token operations
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const COMMON_TESTNET_TOKENS: {
  [chainId: number]: { address: string; symbol: string }[];
} = {
  11155111: [
    // Ethereum Sepolia
    { address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', symbol: 'WETH' },
    { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC' },
  ],
  421614: [
    // Arbitrum Sepolia
    { address: '0x980B62Da83eFF3D4576C647993b0c1D7faF17C73', symbol: 'WETH' },
    { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC' },
  ],
  11155420: [
    // Optimism Sepolia
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    { address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', symbol: 'USDC' },
  ],
};

// Updated types for multi-token support
export interface TokenInfo {
  address: string; // Contract address (or 'native' for native tokens)
  symbol: string;
  name: string;
  decimals: number;
  chainId?: number; // For EVM tokens
  accountId?: string; // For NEAR tokens
}

export interface TokenBalance {
  token: TokenInfo;
  balance: {
    raw: string;
    formatted: string;
  };
  chainBreakdown?: {
    chainId: number;
    chainName: string;
    balance: {
      raw: string;
      formatted: string;
    };
  }[];
}

export interface ChainTokenBalance {
  chainId: number;
  chainName: string;
  address: string; // Wallet address
  tokens: TokenBalance[];
}

export interface WalletAddresses {
  smartWallet: {
    address: string;
    note: string;
  };
  eoa: {
    address: string;
    note: string;
  };
}

export interface MultiChainBalances {
  evm: {
    address: string;
    totalBalances: TokenBalance[]; // Aggregated across all chains
    chainBreakdown: ChainTokenBalance[]; // Per-chain breakdown
    supportedChains: { chainId: number; name: string }[];
    note: string;
  };
  near: {
    accountId: string;
    tokens: TokenBalance[];
  };
  summary: {
    totalEvmChains: number;
    evmChainsWithBalance: number;
    totalEvmTokens: number;
    totalNearTokens: number;
    hasNearBalance: boolean;
  };
}

// Get ERC-20 token info
async function getTokenInfo(
  publicClient: any,
  tokenAddress: string,
  chainId: number
): Promise<TokenInfo | null> {
  try {
    // Ensure address is properly checksummed
    const checksummedAddress = getAddress(tokenAddress);

    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({
        address: checksummedAddress,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }),
      publicClient.readContract({
        address: checksummedAddress,
        abi: ERC20_ABI,
        functionName: 'name',
      }),
      publicClient.readContract({
        address: checksummedAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }),
    ]);

    return {
      address: checksummedAddress,
      symbol: symbol as string,
      name: name as string,
      decimals: decimals as number,
      chainId,
    };
  } catch (error) {
    console.error(
      `Failed to get token info for ${tokenAddress} on chain ${chainId}:`,
      error
    );
    return null;
  }
}

// Get ERC-20 token balance
async function getTokenBalance(
  publicClient: any,
  tokenAddress: string,
  walletAddress: string,
  tokenInfo: TokenInfo
): Promise<{ raw: string; formatted: string } | null> {
  try {
    // Ensure addresses are properly checksummed
    const checksummedTokenAddress = getAddress(tokenAddress);
    const checksummedWalletAddress = getAddress(walletAddress);

    const balance = await publicClient.readContract({
      address: checksummedTokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [checksummedWalletAddress],
    });

    return {
      raw: balance.toString(),
      formatted: formatUnits(balance, tokenInfo.decimals),
    };
  } catch (error) {
    console.error(`Failed to get token balance for ${tokenAddress}:`, error);
    return null;
  }
}

// Get all token balances for a specific chain
async function getChainTokenBalances(
  chainConfig: { chain: Chain; chainId: number; name: string },
  rpcUrl: string,
  walletAddress: string
): Promise<ChainTokenBalance> {
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
    chain: chainConfig.chain,
  });

  const tokens: TokenBalance[] = [];

  // Get native ETH balance
  try {
    const checksummedWalletAddress = getAddress(walletAddress);
    const nativeBalance = await publicClient.getBalance({
      address: checksummedWalletAddress,
    });

    tokens.push({
      token: {
        address: 'native',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: chainConfig.chainId,
      },
      balance: {
        raw: nativeBalance.toString(),
        formatted: formatEther(nativeBalance),
      },
    });
  } catch (error) {
    console.error(
      `Failed to get native balance for ${chainConfig.name}:`,
      error
    );
  }

  // Get ERC-20 token balances
  const tokenAddresses = COMMON_TESTNET_TOKENS[chainConfig.chainId] || [];

  console.log(
    `Checking ${tokenAddresses.length} tokens on ${chainConfig.name}...`
  );

  for (const tokenConfig of tokenAddresses) {
    try {
      console.log(
        `  Checking ${tokenConfig.symbol} at ${tokenConfig.address}...`
      );

      const tokenInfo = await getTokenInfo(
        publicClient,
        tokenConfig.address,
        chainConfig.chainId
      );
      if (!tokenInfo) {
        console.log(
          `  ⚠️  ${tokenConfig.symbol}: Contract not found or invalid`
        );
        continue;
      }

      const balance = await getTokenBalance(
        publicClient,
        tokenConfig.address,
        walletAddress,
        tokenInfo
      );
      if (!balance) {
        console.log(`  ⚠️  ${tokenConfig.symbol}: Failed to get balance`);
        continue;
      }

      if (BigInt(balance.raw) === 0n) {
        console.log(`  ➖ ${tokenConfig.symbol}: Zero balance`);
        continue; // Only include non-zero balances
      }

      console.log(
        `  ✅ ${tokenConfig.symbol}: ${balance.formatted} ${tokenInfo.symbol}`
      );
      tokens.push({
        token: tokenInfo,
        balance,
      });
    } catch (error) {
      console.error(
        `  ❌ Failed to process token ${tokenConfig.symbol} on ${chainConfig.name}:`,
        error
      );
    }
  }

  console.log(
    `${chainConfig.name}: Found ${tokens.length} tokens with balances`
  );

  return {
    chainId: chainConfig.chainId,
    chainName: chainConfig.name,
    address: walletAddress,
    tokens,
  };
}

// Aggregate token balances across chains
function aggregateTokenBalances(
  chainBalances: ChainTokenBalance[]
): TokenBalance[] {
  const tokenMap = new Map<string, TokenBalance>();

  for (const chainBalance of chainBalances) {
    for (const tokenBalance of chainBalance.tokens) {
      const tokenKey = tokenBalance.token.symbol; // Group by symbol

      if (tokenMap.has(tokenKey)) {
        const existing = tokenMap.get(tokenKey)!;

        // Add to existing balance
        const newRaw = (
          BigInt(existing.balance.raw) + BigInt(tokenBalance.balance.raw)
        ).toString();
        const newFormatted = formatUnits(
          BigInt(newRaw),
          existing.token.decimals
        );

        // Add to chain breakdown
        if (!existing.chainBreakdown) existing.chainBreakdown = [];
        existing.chainBreakdown.push({
          chainId: chainBalance.chainId,
          chainName: chainBalance.chainName,
          balance: tokenBalance.balance,
        });

        existing.balance = {
          raw: newRaw,
          formatted: newFormatted,
        };
      } else {
        // Create new token entry
        tokenMap.set(tokenKey, {
          token: tokenBalance.token,
          balance: tokenBalance.balance,
          chainBreakdown: [
            {
              chainId: chainBalance.chainId,
              chainName: chainBalance.chainName,
              balance: tokenBalance.balance,
            },
          ],
        });
      }
    }
  }

  return Array.from(tokenMap.values()).sort((a, b) => {
    // Sort by total value (ETH first, then by balance)
    if (a.token.symbol === 'ETH') return -1;
    if (b.token.symbol === 'ETH') return 1;
    return parseFloat(b.balance.formatted) - parseFloat(a.balance.formatted);
  });
}

export const createMultiChainAccount = async (rpcUrls: {
  [chainId: number]: string;
}) => {
  // Get all supported chains from chains.ts
  const chains = getAllSupportedChains();

  // Validate we have RPC URLs for all chains
  for (const chain of chains) {
    if (!rpcUrls[chain.chainId]) {
      throw new Error(
        `Missing RPC URL for chain ${chain.chainId} (${chain.name})`
      );
    }
  }

  // Generate a single private key for all chains
  const signerPrivateKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerPrivateKey);
  const entryPoint = getEntryPoint('0.7');
  const kernelVersion = KERNEL_V3_1;

  // Create public clients for all chains
  const publicClients = chains.map(({ chain, chainId }) =>
    createPublicClient({
      transport: http(rpcUrls[chainId]),
      chain,
    })
  );

  // Create multi-chain ECDSA validators for all chains
  const validators = await Promise.all(
    publicClients.map(async (publicClient) =>
      toMultiChainECDSAValidator(publicClient, {
        entryPoint,
        signer,
        kernelVersion,
        multiChainIds: chains.map((c) => c.chainId),
      })
    )
  );

  // Create kernel accounts for all chains
  const accounts = await Promise.all(
    publicClients.map(async (publicClient, index) =>
      createKernelAccount(publicClient, {
        plugins: {
          sudo: validators[index],
        },
        entryPoint,
        kernelVersion,
      })
    )
  );

  // Verify all accounts have the same address
  const smartAccountAddress = accounts[0].address;
  const allSameAddress = accounts.every(
    (account) => account.address === smartAccountAddress
  );
  if (!allSameAddress) {
    throw new Error('Multi-chain accounts do not have the same address');
  }

  console.log('Multi-chain smart account address:', smartAccountAddress);

  // Create paymaster clients for all chains
  const paymasterClients = chains.map(({ chainId }) =>
    createZeroDevPaymasterClient({
      chain: chains.find((c) => c.chainId === chainId)!.chain,
      transport: http(rpcUrls[chainId]),
    })
  );

  // Create kernel clients for all chains
  const kernelClients = accounts.map((account, index) =>
    createKernelAccountClient({
      account,
      chain: chains[index].chain,
      bundlerTransport: http(rpcUrls[chains[index].chainId]),
      client: publicClients[index],
      paymaster: {
        getPaymasterData: (userOperation) => {
          return paymasterClients[index].sponsorUserOperation({
            userOperation,
          });
        },
      },
    })
  );

  // Deploy smart wallets on all chains by sending dummy transactions
  console.log('Deploying smart wallets on all chains...');
  const deploymentResults = await Promise.all(
    kernelClients.map(async (kernelClient, index) => {
      const chainName = chains[index].name;
      console.log(`Deploying on ${chainName}...`);

      const userOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account.encodeCalls([
          {
            to: zeroAddress,
            value: BigInt(0),
            data: '0x',
          },
        ]),
      });

      console.log(`${chainName} userOp hash:`, userOpHash);

      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      console.log(
        `${chainName} deployment txn hash:`,
        receipt.receipt.transactionHash
      );
      console.log(`${chainName} deployment completed`);

      return {
        chainId: chains[index].chainId,
        chainName,
        userOpHash,
        transactionHash: receipt.receipt.transactionHash,
      };
    })
  );

  console.log('All smart wallets deployed successfully across all chains');

  return {
    signerPrivateKey,
    smartAccountAddress,
    chainId: chains[0].chainId, // Primary chain
    kernelVersion,
    deployments: deploymentResults,
    supportedChains: chains.map((c) => ({ chainId: c.chainId, name: c.name })),
  };
};

export const getWalletAddresses = async (
  signerPrivateKey: string,
  smartAccountAddress: string
): Promise<WalletAddresses> => {
  const signer = privateKeyToAccount(signerPrivateKey as `0x${string}`);

  return {
    smartWallet: {
      address: smartAccountAddress,
      note: 'Send funds here for smart wallet operations. Same address works on all supported EVM chains.',
    },
    eoa: {
      address: signer.address,
      note: 'This is your MetaMask address if you import the private key. Smart wallet operations use the address above.',
    },
  };
};

// Export function to get testnet token addresses for faucets
export const getTestnetTokenAddresses = () => {
  return COMMON_TESTNET_TOKENS;
};

// Export function to get faucet information
export const getTestnetFaucetInfo = () => {
  return {
    nativeTokens: {
      'Ethereum Sepolia': 'https://sepoliafaucet.com/',
      'Arbitrum Sepolia': 'https://faucet.quicknode.com/arbitrum/sepolia',
      'Optimism Sepolia': 'https://faucet.quicknode.com/optimism/sepolia',
    },
    erc20Tokens: {
      note: 'Most ERC-20 tokens on testnets require minting from their contracts or specific faucets',
      instructions:
        'Visit the token contract on etherscan and look for mint/faucet functions, or check project documentation for testnet token faucets',
    },
    supportedTokens: COMMON_TESTNET_TOKENS,
  };
};

export const getMultiChainBalances = async (
  signerPrivateKey: string,
  smartAccountAddress: string,
  rpcUrls: { [chainId: number]: string }
): Promise<MultiChainBalances> => {
  const chains = getAllSupportedChains();
  console.log('Fetching token balances from all supported chains...');

  // Get token balances from all EVM chains
  const chainBalances = await Promise.all(
    chains.map(async (chainConfig) => {
      const rpcUrl = rpcUrls[chainConfig.chainId];
      return getChainTokenBalances(chainConfig, rpcUrl, smartAccountAddress);
    })
  );

  // Aggregate balances across chains
  const totalBalances = aggregateTokenBalances(chainBalances);

  console.log(`Found ${totalBalances.length} unique tokens across all chains`);

  // Calculate summary statistics
  const evmChainsWithBalance = chainBalances.filter((chain) =>
    chain.tokens.some((token) => parseFloat(token.balance.formatted) > 0)
  ).length;

  const totalEvmTokens = totalBalances.length;

  return {
    evm: {
      address: smartAccountAddress,
      totalBalances,
      chainBreakdown: chainBalances,
      supportedChains: chains.map((c) => ({
        chainId: c.chainId,
        name: c.name,
      })),
      note: 'Token balances aggregated across all supported EVM chains',
    },
    near: {
      accountId: '', // Will be filled by the caller
      tokens: [], // Will be filled by NEAR token discovery
    },
    summary: {
      totalEvmChains: chains.length,
      evmChainsWithBalance,
      totalEvmTokens,
      totalNearTokens: 0, // Will be updated with NEAR tokens
      hasNearBalance: false, // Will be updated with NEAR balance check
    },
  };
};

export const sendTransaction = async (
  zerodevRpc: string,
  signerPrivateKey: string,
  chainId: number = 421614 // Default to Arbitrum Sepolia
) => {
  const chainConfig =
    SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const signer = privateKeyToAccount(signerPrivateKey as `0x${string}`);
  const kernelClient = await getKernelClient(
    zerodevRpc,
    signer,
    '0.7',
    KERNEL_V3_1,
    chainConfig.chain
  );

  console.log('Account address:', kernelClient.account.address);
  console.log('Chain:', chainConfig.name);

  const txnHash = await kernelClient.sendTransaction({
    to: '0x67E7B18CB3e6f6f80492A4345EFC510233836D86',
    value: parseEther('0.001'),
    data: '0x',
  });

  console.log('Txn hash:', txnHash);
  return txnHash;
};

export const getKernelClient = async <
  entryPointVersion extends EntryPointVersion,
>(
  zerodevRpc: string,
  signer: Signer,
  entryPointVersion_: entryPointVersion,
  kernelVersion: GetKernelVersion<entryPointVersion>,
  chain: Chain
) => {
  const publicClient = createPublicClient({
    transport: http(zerodevRpc),
    chain,
  });

  // Use multi-chain validator for consistency with createAccount
  const multiChainValidator = await toMultiChainECDSAValidator(publicClient, {
    signer,
    entryPoint: getEntryPoint(entryPointVersion_),
    kernelVersion,
    multiChainIds: getAllSupportedChains().map((c) => c.chainId),
  });

  const account = await createKernelAccount(publicClient, {
    plugins: {
      sudo: multiChainValidator,
    },
    entryPoint: getEntryPoint(entryPointVersion_),
    kernelVersion,
  });
  console.log('My account:', account.address);
  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(zerodevRpc),
  });
  return createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(zerodevRpc),
    paymaster: {
      getPaymasterData: (userOperation) => {
        return paymasterClient.sponsorUserOperation({
          userOperation,
        });
      },
    },
    client: publicClient,
  });
};

// Legacy function name for backward compatibility
export const createAccount = createMultiChainAccount;
