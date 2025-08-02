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
import { KeyPairString } from '@near-js/crypto';
import { cors } from 'hono/cors';
import { getAllSupportedChains } from './chains';

import { keccak256, toUtf8Bytes } from 'ethers';

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

export default app;
