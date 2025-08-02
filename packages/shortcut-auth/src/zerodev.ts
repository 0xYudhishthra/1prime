import {
  createKernelAccount,
  createZeroDevPaymasterClient,
  createKernelAccountClient,
} from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { toMultiChainECDSAValidator } from '@zerodev/multi-chain-ecdsa-validator';
// TODO: Import CAB functionality when available
// import { createIntentClient } from "@zerodev/intent-client";

import {
  http,
  Hex,
  createPublicClient,
  zeroAddress,
  parseEther,
  formatEther,
  Chain,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import { EntryPointVersion } from 'viem/account-abstraction';
import { GetKernelVersion, Signer } from '@zerodev/sdk/types';
import { SUPPORTED_CHAINS, getAllSupportedChains } from './chains';

// Types for our abstracted functions
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

export interface ChainBalance {
  chainId: number;
  chainName: string;
  address: string;
  balance: {
    raw: string;
    formatted: string;
    symbol: string;
  };
}

export interface TokenBalance {
  token: string;
  symbol: string;
  totalBalance: {
    raw: string;
    formatted: string;
  };
  chainBreakdown: {
    chainId: number;
    chainName: string;
    balance: {
      raw: string;
      formatted: string;
    };
  }[];
}

export interface MultiChainBalances {
  totalBalances: TokenBalance[];
  chainBreakdown: ChainBalance[];
  supportedChains: { chainId: number; name: string }[];
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

export const getMultiChainBalances = async (
  signerPrivateKey: string,
  smartAccountAddress: string,
  rpcUrls: { [chainId: number]: string }
): Promise<MultiChainBalances> => {
  const chains = getAllSupportedChains();
  const signer = privateKeyToAccount(signerPrivateKey as `0x${string}`);

  // TODO: Implement ZeroDev CAB (Chain-Abstracted Balance) when available
  // For now, using individual chain queries as the primary method
  //
  // Future CAB implementation:
  // const intentClient = createIntentClient({
  //   // Configure with your ZeroDev project details
  // });
  // const cab = await intentClient.getCAB({
  //   networks: chains.map(c => c.chainId),
  //   tokenTickers: ["ETH", "USDC", "WETH"], // optional
  // });

  console.log('Fetching balances from all supported chains...');

  // Get balances from all chains
  const chainBreakdown: ChainBalance[] = await Promise.all(
    chains.map(async ({ chain, chainId, name }) => {
      try {
        const publicClient = createPublicClient({
          transport: http(rpcUrls[chainId]),
          chain,
        });

        const balance = await publicClient.getBalance({
          address: smartAccountAddress as `0x${string}`,
        });

        console.log(`${name} balance: ${formatEther(balance)} ETH`);

        return {
          chainId,
          chainName: name,
          address: smartAccountAddress,
          balance: {
            raw: balance.toString(),
            formatted: formatEther(balance),
            symbol: 'ETH',
          },
        };
      } catch (error) {
        console.error(`Failed to fetch balance for ${name}:`, error);
        return {
          chainId,
          chainName: name,
          address: smartAccountAddress,
          balance: {
            raw: '0',
            formatted: '0',
            symbol: 'ETH',
          },
        };
      }
    })
  );

  // Calculate total ETH balance across all chains
  const totalEthBalance = chainBreakdown.reduce(
    (sum, chain) => sum + BigInt(chain.balance.raw),
    0n
  );

  console.log(
    `Total ETH across all chains: ${formatEther(totalEthBalance)} ETH`
  );

  // Create unified token balance structure
  const totalBalances: TokenBalance[] = [
    {
      token: 'ETH',
      symbol: 'ETH',
      totalBalance: {
        raw: totalEthBalance.toString(),
        formatted: formatEther(totalEthBalance),
      },
      chainBreakdown: chainBreakdown
        .map((chain) => ({
          chainId: chain.chainId,
          chainName: chain.chainName,
          balance: {
            raw: chain.balance.raw,
            formatted: chain.balance.formatted,
          },
        }))
        .filter((chain) => BigInt(chain.balance.raw) > 0n), // Only include chains with balance
    },
  ];

  return {
    totalBalances,
    chainBreakdown,
    supportedChains: chains.map((c) => ({ chainId: c.chainId, name: c.name })),
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
