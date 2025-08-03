import { Hono } from 'hono';
import { createAuth } from '../auth';
import {
  createMultiChainAccount,
  sendTransaction,
  getWalletAddresses,
  getMultiChainBalances,
  getTestnetTokenAddresses,
  getTestnetFaucetInfo,
} from './zerodev';
import { smartWallet } from './db/schema';
import { createDb } from './db';
import { eq } from 'drizzle-orm';
import {
  createFundedTestnetAccountNear,
  sendNearTransaction,
  getNearBalance,
  getAllNearTokenBalances,
  getNearTokenBalanceDetails,
  checkSpecificNearToken,
  getBridgeTokenInfo,
} from './nearwallet';
import { KeyPairString, KeyPair } from '@near-js/crypto';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { cors } from 'hono/cors';
import { getAllSupportedChains, SUPPORTED_CHAINS } from './chains';
import { keccak256, toUtf8Bytes } from 'ethers';
import { CrossChainSwapService } from './services/cross-chain-swap';
import { CrossChainSwapRequest } from './types/cross-chain';
import { crossChainOrder } from './db/schema';

// Map user-friendly chain names to chain IDs
function mapChainNameToId(chainName: string): string {
  const chainMapping: Record<string, string> = {
    // EVM chains (using SUPPORTED_CHAINS)
    'ethereum': '11155111',      // Ethereum Sepolia
    'arbitrum': '421614',        // Arbitrum Sepolia  
    'optimism': '11155420',      // Optimism Sepolia
    // NEAR chains
    'near': '398',               // NEAR Testnet
    'near-testnet': '398',       // NEAR Testnet (alternative)
    'near-mainnet': 'mainnet',   // NEAR Mainnet
  };
  
  return chainMapping[chainName.toLowerCase()] || chainName; // Lowercase and return original if no mapping found
}

// Convert user-friendly amount to smallest unit (for USDC: 6 decimals)
function convertAmountToSmallestUnit(amount: string): string {
  const USDC_DECIMALS = 6;
  const amountFloat = parseFloat(amount);
  
  if (isNaN(amountFloat)) {
    throw new Error('Invalid amount format');
  }
  
  // Convert to smallest unit (multiply by 10^6 for USDC)
  const smallestUnitAmount = Math.floor(amountFloat * Math.pow(10, USDC_DECIMALS));
  return smallestUnitAmount.toString();
}

// Get USDC contract address for a given chain ID
function getUSDCAddress(chainId: string): string {
  const usdcAddresses: Record<string, string> = {
    // EVM Testnets
    '11155111': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // ETH Sepolia USDC
    '421614': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',   // Arbitrum Sepolia USDC (placeholder - update with real address)
    '11155420': '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', // Optimism Sepolia USDC (placeholder - update with real address)
    // NEAR
    '398': '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af', // NEAR Testnet USDC
    'mainnet': 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near', // NEAR Mainnet USDC (placeholder)
  };
  
  const address = usdcAddresses[chainId];
  if (!address) {
    throw new Error(`USDC contract address not found for chain ID: ${chainId}`);
  }
  
  return address;
}

// Approve USDC spending on NEAR for cross-chain swaps
async function approveUSDCOnNear(
  amount: string,
  nearAccountId: string,
  nearKeypair: KeyPairString,
  usdcContractAddress: string
): Promise<void> {
  const NEAR_RPC_URL = 'https://rpc.testnet.near.org';
  const SPENDER_ID = '1prime-global-factory-contract.testnet';
  
  console.log('Approving USDC spending on NEAR:', {
    amount,
    nearAccountId,
    usdcContractAddress,
    spenderId: SPENDER_ID
  });

  try {
    // Create NEAR provider and signer
    const provider = new JsonRpcProvider({ url: NEAR_RPC_URL });
    const keyPair = KeyPair.fromString(nearKeypair);
    const signer = new KeyPairSigner(keyPair);
    
    // Create NEAR account instance
    const account = new Account(nearAccountId, provider as any, signer);
    
    // Call approve function on USDC contract
    const result = await account.callFunction({
      contractId: usdcContractAddress,
      methodName: 'approve',
      args: {
        spender_id: SPENDER_ID,
        value: amount
      },
      gas: '30000000000000', // 30 TGas
      deposit: '0', // No deposit needed for approve
    });
    
    console.log('USDC approval successful:', result);
  } catch (error) {
    console.error('USDC approval failed:', error);
    throw new Error(`Failed to approve USDC spending on NEAR: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const app = new Hono<{
  Bindings: CloudflareBindings;
}>();

// Add CORS middleware
app.use(
  '*',
  cors({
    origin: '*', // For development - restrict this in production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.on(['GET', 'POST'], '/api/**', (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.post('/sign-up/email', async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(c.env);
  const { email, password } = await c.req.json();
  console.log('email', email);

  const data = await auth.api.signUpEmail({
    body: {
      name: 'John Doe',
      email: email,
      password: password,
      image: 'https://example.com/image.png',
    },
  });

  const nameToNearAccountId = data.user.id.toLowerCase();

  // Prepare RPC URLs for all supported chains
  const rpcUrls = {
    11155111: c.env.ZERODEV_ETHEREUM_SEPOLIA_RPC,
    421614: c.env.ZERODEV_ARBITRUM_SEPOLIA_RPC,
    11155420: c.env.ZERODEV_OPTIMISM_SEPOLIA_RPC,
  };

  // Validate all required environment variables
  const missingRpcs = Object.entries(rpcUrls).filter(([_, rpc]) => !rpc);
  if (missingRpcs.length > 0) {
    const missingChains = missingRpcs.map(([chainId]) => chainId).join(', ');
    return c.json(
      {
        error: `Missing required ZeroDev RPC URLs for chains: ${missingChains}`,
      },
      500
    );
  }

  try {
    const {
      signerPrivateKey,
      smartAccountAddress,
      chainId,
      kernelVersion,
      deployments,
      supportedChains,
    } = await createMultiChainAccount(rpcUrls);

    if (
      !signerPrivateKey ||
      !smartAccountAddress ||
      !chainId ||
      !kernelVersion ||
      !deployments ||
      !supportedChains
    ) {
      return c.json({ error: 'Failed to create multi-chain evm account' }, 500);
    }

    const nearAccount = await createFundedTestnetAccountNear(
      `${nameToNearAccountId}.testnet`
    );

    if (!nearAccount) {
      return c.json({ error: 'Failed to create near account' }, 500);
    }

    await db.insert(smartWallet).values({
      userId: data.user.id,
      evm_signerPrivateKey: signerPrivateKey,
      evm_smartAccountAddress: smartAccountAddress,
      evm_chainId: chainId,
      evm_kernelVersion: kernelVersion,
      evm_supportedChains: supportedChains,
      near_accountId: nearAccount.accountId,
      near_keypair: nearAccount.keyPair.toString(),
    });

    // Log multi-chain deployment information
    console.log('Multi-chain smart wallet created:', {
      userId: data.user.id,
      smartAccountAddress,
      supportedChains,
      deployments: deployments.map((d) => ({
        chainId: d.chainId,
        chainName: d.chainName,
        transactionHash: d.transactionHash,
      })),
    });

    console.log(data);
    return c.json(data.token);
  } catch (error) {
    console.error('Account creation error:', error);
    return c.json({ error: 'Failed to create accounts' }, 500);
  }
});

app.post('/sign-in/email', async (c) => {
  const auth = createAuth(c.env);
  const { email, password } = await c.req.json();

  try {
    const data = await auth.api.signInEmail({
      body: {
        email: email,
        password: password,
      },
    });

    return c.json(data.token);
  } catch (error) {
    console.error('Sign in error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }
});

app.post('/api/send-transaction', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(session);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  try {
    const txnHash = await sendTransaction(
      c.env.ZERODEV_ARBITRUM_SEPOLIA_RPC,
      wallet[0].evm_signerPrivateKey
    );

    console.log('signerPrivateKey', wallet[0].evm_signerPrivateKey);
    console.log('smartAccountAddress', wallet[0].evm_smartAccountAddress);
    console.log('chainId', wallet[0].evm_chainId);
    console.log('kernelVersion', wallet[0].evm_kernelVersion);
    console.log('txnHash', txnHash);
    return c.json({ txnHash });
  } catch (error) {
    console.error('Transaction error:', error);
    return c.json({ error: 'Failed to send transaction' }, 500);
  }
});

app.get('/api/random-number', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(c.req.raw.headers);
  console.log(session);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const number = Math.floor(Math.random() * 100);
  return c.json({ number });
});

app.get('/create-near-account', async (c) => {
  const userId = '4ErVTktFNUW7KWXaERVHeolyggRdhCXo';

  const nameToNearAccountId = userId.toLowerCase();
  const nearAccount = await createFundedTestnetAccountNear(
    `${nameToNearAccountId}.testnet`
  );

  if (!nearAccount) {
    return c.json({ error: 'Failed to create near account' }, 500);
  }

  return c.json({ nearAccount });
});

app.post('/api/send-near-transaction', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  console.log(session);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  if (!wallet[0].near_accountId || !wallet[0].near_keypair) {
    return c.json({ error: 'No near account found' }, 500);
  }

  try {
    const result = await sendNearTransaction(
      wallet[0].near_accountId,
      wallet[0].near_keypair as KeyPairString
    );

    console.log('result', result);
    return c.json({ result });
  } catch (error) {
    console.error('NEAR transaction error:', error);
    return c.json({ error: 'Failed to send NEAR transaction' }, 500);
  }
});

app.get('/api/wallet/supported-chains', async (c) => {
  const chains = getAllSupportedChains().map(({ chainId, name }) => ({
    chainId,
    name,
  }));

  return c.json({ chains });
});

app.get('/api/wallet/addresses', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  try {
    const evmAddresses = await getWalletAddresses(
      wallet[0].evm_signerPrivateKey,
      wallet[0].evm_smartAccountAddress
    );

    return c.json({
      evm: evmAddresses,
      near: {
        accountId: wallet[0].near_accountId,
      },
      supportedChains: getAllSupportedChains().map(({ chainId, name }) => ({
        chainId,
        name,
      })),
      usage: {
        deposits:
          'Send EVM funds to evm.smartWallet.address for best experience',
        transactions:
          'All smart wallet operations use evm.smartWallet.address across all supported chains',
      },
    });
  } catch (error) {
    console.error('Address fetch error:', error);
    return c.json({ error: 'Failed to fetch addresses' }, 500);
  }
});

app.get('/api/wallet/near/bridge-info', async (c) => {
  const bridgeInfo = getBridgeTokenInfo();

  return c.json({
    message: 'NEAR bridge token information',
    ...bridgeInfo,
    troubleshooting: {
      issue:
        "If you bridged tokens but don't see them, they might have a different account ID than expected",
      solution:
        'Use the /check-token endpoint below to manually verify specific token contracts',
      commonIssues: [
        'Token bridged to mainnet instead of testnet',
        'Token has a different account ID pattern',
        'Bridge transaction failed or is still pending',
      ],
    },
  });
});

app.post('/api/wallet/near/check-token', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { tokenAccountId } = await c.req.json();

  if (!tokenAccountId) {
    return c.json({ error: 'tokenAccountId is required' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  if (!wallet[0].near_accountId) {
    return c.json({ error: 'No NEAR account found' }, 404);
  }

  try {
    const tokenBalance = await checkSpecificNearToken(
      wallet[0].near_accountId,
      tokenAccountId
    );

    if (!tokenBalance) {
      return c.json({
        found: false,
        message: `No balance found for token ${tokenAccountId}`,
        suggestions: [
          'Check if the token account ID is correct',
          'Verify the token exists on NEAR testnet',
          "Make sure you've actually received the tokens",
        ],
      });
    }

    return c.json({
      found: true,
      tokenBalance,
      message: `Found ${tokenBalance.balance.formatted} ${tokenBalance.token.symbol}`,
    });
  } catch (error) {
    console.error('Token check error:', error);
    return c.json({ error: 'Failed to check token' }, 500);
  }
});

app.get('/api/wallet/testnet-tokens', async (c) => {
  const faucetInfo = getTestnetFaucetInfo();
  const tokenAddresses = getTestnetTokenAddresses();

  return c.json({
    message: 'Testnet token information and faucet links',
    faucets: faucetInfo,
    tokenAddresses,
    instructions: {
      step1: 'Get native tokens (ETH) from the faucets listed above',
      step2:
        'For ERC-20 tokens, you may need to mint them from the contract or find specific token faucets',
      step3:
        'Check token contract pages on Etherscan for mint/faucet functions',
      step4:
        'Some tokens may not be available on all testnets - this is normal',
    },
  });
});

app.get('/api/wallet/balances', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  try {
    // Prepare RPC URLs for all supported chains
    const rpcUrls = {
      11155111: c.env.ZERODEV_ETHEREUM_SEPOLIA_RPC,
      421614: c.env.ZERODEV_ARBITRUM_SEPOLIA_RPC,
      11155420: c.env.ZERODEV_OPTIMISM_SEPOLIA_RPC,
    };

    // Get multi-chain EVM balances using ZeroDev
    const evmBalances = await getMultiChainBalances(
      wallet[0].evm_signerPrivateKey,
      wallet[0].evm_smartAccountAddress,
      rpcUrls
    );

    // Get NEAR token balances (all tokens)
    const nearTokens = await getAllNearTokenBalances(wallet[0].near_accountId!);

    // Update the EVM balances with NEAR account info
    const updatedEvmBalances = {
      ...evmBalances,
      near: {
        accountId: wallet[0].near_accountId!,
        tokens: nearTokens,
      },
      summary: {
        ...evmBalances.summary,
        totalNearTokens: nearTokens.length,
        hasNearBalance: nearTokens.some(
          (token) => parseFloat(token.balance.formatted) > 0
        ),
      },
    };

    return c.json(updatedEvmBalances);
  } catch (error) {
    console.error('Balance fetch error:', error);
    return c.json({ error: 'Failed to fetch balances' }, 500);
  }
});

app.post("/hash-random-number", async (c) => {
  const { number } = await c.req.json();
  console.log(number);
  const hash = keccak256(toUtf8Bytes(number));
  console.log(hash);
  return c.json({ hash });
});

app.post('/api/cross-chain-swap', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const wallet = await db
    .select()
    .from(smartWallet)
    .where(eq(smartWallet.userId, session.user.id))
    .limit(1);

  if (!wallet[0]) {
    return c.json({ error: 'Wallet not found' }, 404);
  }

  if (!wallet[0].evm_smartAccountAddress || !wallet[0].evm_signerPrivateKey) {
    return c.json({ error: 'EVM smart wallet not properly configured' }, 400);
  }

  try {
    const swapRequest: CrossChainSwapRequest = await c.req.json();
    
    // Validate request
    if (!swapRequest.amount || !swapRequest.fromChain || !swapRequest.toChain) {
      return c.json({ error: 'Missing required swap parameters (amount, fromChain, toChain)' }, 400);
    }

    // Map chain names to chain IDs and convert amount
    const fromChainId = mapChainNameToId(swapRequest.fromChain);
    const toChainId = mapChainNameToId(swapRequest.toChain);
    
    let convertedAmount: string;
    try {
      convertedAmount = convertAmountToSmallestUnit(swapRequest.amount);
    } catch (error) {
      return c.json({ error: `Invalid amount: ${swapRequest.amount}. Please provide a valid number.` }, 400);
    }
    
    // Auto-assign USDC contract addresses based on chains
    let fromTokenAddress: string;
    let toTokenAddress: string;
    try {
      fromTokenAddress = getUSDCAddress(fromChainId);
      toTokenAddress = getUSDCAddress(toChainId);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error getting USDC addresses' }, 400);
    }
    
    // Validate supported chain IDs
    const supportedChainIds = ["11155111", "421614", "11155420", "398", "mainnet"]; // ETH Sepolia, Arbitrum Sepolia, Optimism Sepolia, NEAR Testnet, NEAR Mainnet
    
    if (!supportedChainIds.includes(fromChainId)) {
      return c.json({ error: `Unsupported source chain: ${swapRequest.fromChain} (mapped to ${fromChainId})` }, 400);
    }
    
    if (!supportedChainIds.includes(toChainId)) {
      return c.json({ error: `Unsupported destination chain: ${swapRequest.toChain} (mapped to ${toChainId})` }, 400);
    }

    // For NEAR source chains, validate NEAR credentials
    const sourceIsNear = fromChainId === '398' || fromChainId === 'mainnet';
    if (sourceIsNear && (!wallet[0].near_accountId || !wallet[0].near_keypair)) {
      return c.json({ error: 'NEAR wallet not properly configured for NEAR source chain' }, 400);
    }

    console.log('Starting bi-directional cross-chain swap:', {
      userId: session.user.id,
      sourceChain: swapRequest.fromChain,
      destinationChain: swapRequest.toChain,
      sourceChainId: fromChainId,
      destinationChainId: toChainId,
      originalAmount: swapRequest.amount,
      convertedAmount: convertedAmount,
      fromTokenAddress: fromTokenAddress,
      toTokenAddress: toTokenAddress,
      sourceIsNear: sourceIsNear,
      evmAddress: wallet[0].evm_smartAccountAddress,
      nearAccountId: wallet[0].near_accountId,
      request: swapRequest,
    });

    // Step 0: For NEAR source chains, approve USDC spending before starting swap
    if (sourceIsNear && wallet[0].near_accountId && wallet[0].near_keypair) {
      try {
        console.log('Approving USDC spending on NEAR before swap...');
        await approveUSDCOnNear(
          convertedAmount,
          wallet[0].near_accountId,
          wallet[0].near_keypair as KeyPairString,
          fromTokenAddress
        );
        console.log('NEAR USDC approval completed successfully');
      } catch (error) {
        console.error('NEAR USDC approval failed:', error);
        return c.json({
          success: false,
          error: `NEAR USDC approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: Date.now(),
        }, 500);
      }
    }

    // Initialize swap service
    const swapService = new CrossChainSwapService(c.env.DATABASE_URL);
    swapService.setDatabase(db);

    // Create normalized swap request with chain IDs, converted amount, and USDC addresses for relayer
    const normalizedSwapRequest = {
      ...swapRequest,
      fromChain: fromChainId,
      toChain: toChainId,
      amount: convertedAmount,
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
    };

    // Execute the complete swap flow with bi-directional support
    const result = await swapService.executeSwap(
      normalizedSwapRequest,
      session.user.id,
      wallet[0].evm_smartAccountAddress,
      wallet[0].evm_signerPrivateKey,
      wallet[0].near_accountId || undefined,
      wallet[0].near_keypair as KeyPairString || undefined
    );

    console.log('Cross-chain swap result:', result);

    return c.json({
      success: result.result === 'completed',
      data: {
        orderId: result.orderId,
        status: result.result,
        message: result.result === 'completed' 
          ? 'Cross-chain swap completed successfully' 
          : 'Cross-chain swap failed',
      },
      error: result.error,
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('Cross-chain swap error:', error);
    return c.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: Date.now(),
    }, 500);
  }
});

app.get('/api/cross-chain-swap/:orderId/status', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const orderId = c.req.param('orderId');
  
  try {
    const db = createDb(c.env.DATABASE_URL);
    const swapService = new CrossChainSwapService(c.env.DATABASE_URL);
    swapService.setDatabase(db);

    const orderStatus = await swapService.getOrderStatus(orderId);
    
    if (!orderStatus) {
      return c.json({ error: 'Order not found' }, 404);
    }

    // Verify user owns this order
    if (orderStatus.userId !== session.user.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Prefer live relayer status over local database status
    const currentStatus = orderStatus.liveStatus || {
      phase: orderStatus.currentPhase,
      isCompleted: orderStatus.isCompleted,
    };

    return c.json({
      success: true,
      data: {
        orderId: orderStatus.id,
        orderHash: orderStatus.orderHash,
        currentPhase: currentStatus.phase,
        isCompleted: currentStatus.isCompleted,
        isSuccessful: orderStatus.isSuccessful,
        errorMessage: orderStatus.errorMessage,
        secretRevealed: orderStatus.secretRevealed,
        sourceChain: orderStatus.sourceChain,
        destinationChain: orderStatus.destinationChain,
        sourceToken: orderStatus.sourceToken,
        destinationToken: orderStatus.destinationToken,
        sourceAmount: orderStatus.sourceAmount,
        destinationAmount: orderStatus.destinationAmount,
        statusHistory: orderStatus.statusHistory,
        createdAt: orderStatus.createdAt,
        completedAt: orderStatus.completedAt,
        // Include live relayer data if available
        liveRelayerStatus: orderStatus.liveStatus,
        dataSource: orderStatus.liveStatus ? 'relayer' : 'local',
      },
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('Order status fetch error:', error);
    return c.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch order status',
      timestamp: Date.now(),
    }, 500);
  }
});

app.get('/api/cross-chain-swap/orders', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const db = createDb(c.env.DATABASE_URL);
    const swapService = new CrossChainSwapService(c.env.DATABASE_URL);
    swapService.setDatabase(db);

    const orders = await swapService.getUserOrders(session.user.id);

    return c.json({
      success: true,
      data: orders.map(order => ({
        orderId: order.id,
        orderHash: order.orderHash,
        currentPhase: order.currentPhase,
        isCompleted: order.isCompleted,
        isSuccessful: order.isSuccessful,
        sourceChain: order.sourceChain,
        destinationChain: order.destinationChain,
        sourceToken: order.sourceToken,
        destinationToken: order.destinationToken,
        sourceAmount: order.sourceAmount,
        destinationAmount: order.destinationAmount,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
      })),
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('Orders fetch error:', error);
    return c.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch orders',
      timestamp: Date.now(),
    }, 500);
  }
});

export default app;
