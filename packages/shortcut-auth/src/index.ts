import { Hono } from 'hono';
import { createAuth } from '../auth';
import { createAccount, sendTransaction } from './zerodev';
import { smartWallet } from './db/schema';
import { createDb } from './db';
import { eq } from 'drizzle-orm';
import {
  createFundedTestnetAccountNear,
  sendNearTransaction,
  getNearBalance,
} from './nearwallet';
import { KeyPairString } from '@near-js/crypto';
import { cors } from 'hono/cors';
import { createPublicClient, http, formatEther } from 'viem';
import { sepolia, arbitrumSepolia, optimismSepolia } from 'viem/chains';

// Chain configuration
const SUPPORTED_CHAINS = {
  11155111: { chain: sepolia, name: 'Ethereum Sepolia' },
  421614: { chain: arbitrumSepolia, name: 'Arbitrum Sepolia' },
  11155420: { chain: optimismSepolia, name: 'Optimism Sepolia' },
} as const;

function getChainConfig(chainId: number) {
  const config = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
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

  // Validate all required environment variables
  if (
    !c.env.ZERODEV_ETHEREUM_SEPOLIA_RPC ||
    !c.env.ZERODEV_ARBITRUM_SEPOLIA_RPC ||
    !c.env.ZERODEV_OPTIMISM_SEPOLIA_RPC
  ) {
    return c.json(
      { error: 'Missing required ZeroDev RPC URLs for multi-chain deployment' },
      500
    );
  }

  const {
    signerPrivateKey,
    smartAccountAddress,
    chainId,
    kernelVersion,
    deployments,
    supportedChains,
  } = await createAccount(
    c.env.ZERODEV_ETHEREUM_SEPOLIA_RPC,
    c.env.ZERODEV_ARBITRUM_SEPOLIA_RPC,
    c.env.ZERODEV_OPTIMISM_SEPOLIA_RPC
  );

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
});

app.post('/sign-in/email', async (c) => {
  const auth = createAuth(c.env);
  const { email, password } = await c.req.json();
  const data = await auth.api.signInEmail({
    body: {
      email: email,
      password: password,
    },
  });

  return c.json(data.token);
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

  if (!wallet[0].near_accountId || !wallet[0].near_keypair) {
    return c.json({ error: 'No near account found' }, 500);
  }

  const result = await sendNearTransaction(
    wallet[0].near_accountId,
    wallet[0].near_keypair as KeyPairString
  );

  console.log('result', result);

  return c.json({ result });
});

app.get('/api/wallet/supported-chains', async (c) => {
  const chains = Object.entries(SUPPORTED_CHAINS).map(([chainId, config]) => ({
    chainId: parseInt(chainId),
    name: config.name,
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
    // Get chain configuration from API parameter
    const chainConfig = getChainConfig(11155111);

    return c.json({
      evm: {
        address: wallet[0].evm_smartAccountAddress,
        chainId: 11155111,
        chainName: chainConfig.name,
      },
      near: {
        accountId: wallet[0].near_accountId,
      },
    });
  } catch (error) {
    console.error('Address fetch error:', error);
    return c.json({ error: 'Failed to fetch addresses' }, 500);
  }
});

app.get('/api/wallet/balances', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Get chainId from query parameter
  const chainIdParam = c.req.query('chainId');
  if (!chainIdParam) {
    return c.json({ error: 'chainId query parameter is required' }, 400);
  }

  const chainId = parseInt(chainIdParam);
  if (isNaN(chainId)) {
    return c.json({ error: 'Invalid chainId parameter' }, 400);
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
    // Get chain configuration from API parameter
    const chainConfig = getChainConfig(chainId);

    // Get EVM balance
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(),
    });

    const evmBalance = await publicClient.getBalance({
      address: wallet[0].evm_smartAccountAddress as `0x${string}`,
    });

    // Get NEAR balance using abstracted function
    const nearBalance = await getNearBalance(wallet[0].near_accountId!);

    return c.json({
      evm: {
        address: wallet[0].evm_smartAccountAddress,
        chainId: chainId,
        chainName: chainConfig.name,
        balance: {
          raw: evmBalance.toString(),
          formatted: formatEther(evmBalance),
          symbol: 'ETH',
        },
      },
      near: {
        accountId: wallet[0].near_accountId,
        balance: nearBalance,
      },
    });
  } catch (error) {
    console.error('Balance fetch error:', error);
    return c.json({ error: 'Failed to fetch balances' }, 500);
  }
});

app.get('/api/wallet/export-private-key', async (c) => {
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

  return c.json({
    warning: 'DEVELOPMENT ONLY - Keep this private key secure!',
    signerPrivateKey: wallet[0].evm_signerPrivateKey,
    smartWalletAddress: wallet[0].evm_smartAccountAddress,
    note: 'Import the signerPrivateKey into MetaMask. The resulting address will be different from smartWalletAddress.',
  });
});

export default app;
