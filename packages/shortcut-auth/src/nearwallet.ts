import {
  createFundedTestnetAccount,
  generateRandomKeyPair,
} from '@near-js/client';
import { JsonRpcProvider, Provider } from '@near-js/providers';
import { Account } from '@near-js/accounts';
import { KeyPairString } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { NEAR } from '@near-js/tokens';

// Common NEAR testnet tokens (NEP-141) - only real testnet tokens
const COMMON_NEAR_TOKENS = [
  // User's specific USDC contract
  {
    accountId:
      '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
    symbol: 'USDC',
    decimals: 6,
  },
];

export interface NearTokenInfo {
  accountId: string; // Token contract account ID
  symbol: string;
  name?: string;
  decimals: number;
}

export interface NearTokenBalance {
  token: NearTokenInfo;
  balance: {
    raw: string;
    formatted: string;
  };
}

export async function createFundedTestnetAccountNear(accountId: string) {
  if (!accountId) {
    console.log('accountId is required');
    return;
  }

  // create new keypair and persist it to filesystem keystore
  const keyPair = generateRandomKeyPair('ed25519');

  console.log('keyPair', keyPair.getPublicKey().toString());

  // call funded testnet creation endpoint
  const account = await createFundedTestnetAccount({
    newAccount: accountId,
    newPublicKey: keyPair.getPublicKey().toString(),
    endpointUrl: 'https://helper.testnet.near.org/account',
  });

  console.log('Created funded testnet account');
  console.log(
    `New Account | ${accountId} | ${keyPair.getPublicKey().toString()}`
  );

  return {
    accountId,
    keyPair,
    transaction: account.final_execution_status,
  };
}

export async function sendNearTransaction(
  accountId: string,
  keyPair: KeyPairString
) {
  const provider = new JsonRpcProvider({
    url: 'https://test.rpc.fastnear.com',
  }) as Provider;
  const signer = KeyPairSigner.fromSecretKey(keyPair);
  const account = new Account(accountId, provider, signer);

  // transfer 0.1 NEAR tokens to receiver.testnet
  const result = await account.transfer({
    token: NEAR,
    amount: NEAR.toUnits('0.1'),
    receiverId: accountId,
  });

  return result;
}

// Get NEP-141 token metadata
async function getNearTokenMetadata(
  provider: Provider,
  tokenAccountId: string
): Promise<NearTokenInfo | null> {
  try {
    const result = await provider.query({
      request_type: 'call_function',
      finality: 'final',
      account_id: tokenAccountId,
      method_name: 'ft_metadata',
      args_base64: '',
    });

    if (result && 'result' in result && result.result) {
      // Convert the result to a proper format
      const resultArray = result.result as number[] | Uint8Array;
      const uint8Array = Array.isArray(resultArray)
        ? new Uint8Array(resultArray)
        : resultArray;

      // Convert Uint8Array to string
      const decoder = new TextDecoder();
      const jsonString = decoder.decode(uint8Array);

      const metadata = JSON.parse(jsonString);
      return {
        accountId: tokenAccountId,
        symbol: metadata.symbol || 'UNKNOWN',
        name: metadata.name || '',
        decimals: metadata.decimals || 24,
      };
    }
  } catch (error: any) {
    // Only log if it's not a simple "account doesn't exist" error
    if (error?.type !== 'AccountDoesNotExist') {
      console.error(`Failed to get metadata for ${tokenAccountId}:`, error);
    }
  }
  return null;
}

// Get NEP-141 token balance
async function getNearTokenBalance(
  provider: Provider,
  tokenAccountId: string,
  userAccountId: string,
  decimals: number
): Promise<{ raw: string; formatted: string } | null> {
  try {
    const args = JSON.stringify({ account_id: userAccountId });
    const encoder = new TextEncoder();
    const argsBytes = encoder.encode(args);

    // Convert to base64
    const argsBase64 = btoa(String.fromCharCode(...argsBytes));

    const result = await provider.query({
      request_type: 'call_function',
      finality: 'final',
      account_id: tokenAccountId,
      method_name: 'ft_balance_of',
      args_base64: argsBase64,
    });

    if (result && 'result' in result && result.result) {
      // Convert the result to a proper format
      const resultArray = result.result as number[] | Uint8Array;
      const uint8Array = Array.isArray(resultArray)
        ? new Uint8Array(resultArray)
        : resultArray;

      // Convert Uint8Array to string
      const decoder = new TextDecoder();
      const jsonString = decoder.decode(uint8Array);

      const balance = JSON.parse(jsonString);
      const balanceStr = balance.toString();
      const formatted = (
        parseFloat(balanceStr) / Math.pow(10, decimals)
      ).toFixed(Math.min(decimals, 6));

      return {
        raw: balanceStr,
        formatted,
      };
    }
  } catch (error: any) {
    // Only log if it's not a simple "account doesn't exist" error
    if (error?.type !== 'AccountDoesNotExist') {
      console.error(`Failed to get balance for ${tokenAccountId}:`, error);
    }
  }
  return null;
}

export async function getNearBalance(accountId: string) {
  const provider = new JsonRpcProvider({
    url: 'https://test.rpc.fastnear.com',
  }) as Provider;

  try {
    const account = await provider.query({
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });

    // Type assertion for the account response
    const accountData = account as any;

    return {
      raw: accountData.amount,
      formatted: (parseFloat(accountData.amount) / 1e24).toFixed(4),
      symbol: 'NEAR',
    };
  } catch (error) {
    console.error('NEAR balance fetch error:', error);
    throw error;
  }
}

export async function getAllNearTokenBalances(
  accountId: string
): Promise<NearTokenBalance[]> {
  const provider = new JsonRpcProvider({
    url: 'https://test.rpc.fastnear.com',
  }) as Provider;

  const tokens: NearTokenBalance[] = [];

  console.log(`🔍 NEAR: Checking tokens for account ${accountId}...`);

  // Get native NEAR balance
  try {
    const nearBalance = await getNearBalance(accountId);
    console.log(`  ✅ NEAR: ${nearBalance.formatted} NEAR`);
    tokens.push({
      token: {
        accountId: 'native',
        symbol: 'NEAR',
        name: 'NEAR Protocol',
        decimals: 24,
      },
      balance: {
        raw: nearBalance.raw,
        formatted: nearBalance.formatted,
      },
    });
  } catch (error) {
    console.error('  ❌ Failed to get native NEAR balance:', error);
  }

  // Check common NEP-141 tokens
  console.log(`  📋 Checking ${COMMON_NEAR_TOKENS.length} NEP-141 tokens...`);

  for (const tokenConfig of COMMON_NEAR_TOKENS) {
    try {
      console.log(
        `    🔍 Checking ${tokenConfig.symbol} (${tokenConfig.accountId})...`
      );

      // Get token metadata (with fallback to known values)
      let tokenInfo = await getNearTokenMetadata(
        provider,
        tokenConfig.accountId
      );
      if (!tokenInfo) {
        console.log(
          `    ⚠️  ${tokenConfig.symbol}: No metadata found, using fallback values`
        );
        tokenInfo = {
          accountId: tokenConfig.accountId,
          symbol: tokenConfig.symbol,
          decimals: tokenConfig.decimals,
        };
      } else {
        console.log(
          `    📄 ${tokenConfig.symbol}: Found metadata - ${tokenInfo.name || 'No name'}`
        );
      }

      // Get token balance
      const balance = await getNearTokenBalance(
        provider,
        tokenConfig.accountId,
        accountId,
        tokenInfo.decimals
      );

      if (!balance) {
        console.log(
          `    ⚠️  ${tokenConfig.symbol}: Contract doesn't exist or failed to get balance`
        );
        continue;
      }

      console.log(`    🔍 ${tokenConfig.symbol}: Raw balance = ${balance.raw}`);

      if (parseFloat(balance.raw) > 0) {
        console.log(
          `    ✅ ${tokenConfig.symbol}: ${balance.formatted} ${tokenInfo.symbol}`
        );
        tokens.push({
          token: tokenInfo,
          balance,
        });
      } else {
        console.log(`    ➖ ${tokenConfig.symbol}: Zero balance`);
      }
    } catch (error) {
      console.error(
        `    ❌ Failed to process NEAR token ${tokenConfig.symbol}:`,
        error
      );
    }
  }

  console.log(`🏁 NEAR: Found ${tokens.length} tokens with balances`);
  return tokens;
}

// Enhanced function that returns both legacy format and new multi-token format
export async function getNearTokenBalanceDetails(accountId: string) {
  const tokens = await getAllNearTokenBalances(accountId);

  // Find native NEAR token for legacy compatibility
  const nativeNear = tokens.find((t) => t.token.symbol === 'NEAR');

  return {
    // Legacy format for backward compatibility
    legacy: nativeNear
      ? {
          raw: nativeNear.balance.raw,
          formatted: nativeNear.balance.formatted,
          symbol: 'NEAR',
        }
      : {
          raw: '0',
          formatted: '0.0000',
          symbol: 'NEAR',
        },
    // New multi-token format
    tokens,
  };
}

// Function to manually check a specific NEAR token
export async function checkSpecificNearToken(
  accountId: string,
  tokenAccountId: string
): Promise<NearTokenBalance | null> {
  const provider = new JsonRpcProvider({
    url: 'https://test.rpc.fastnear.com',
  }) as Provider;

  try {
    console.log(
      `🔍 Checking specific NEAR token: ${tokenAccountId} for ${accountId}`
    );

    // Get token metadata
    let tokenInfo = await getNearTokenMetadata(provider, tokenAccountId);
    if (!tokenInfo) {
      console.log(
        `⚠️  No metadata found for ${tokenAccountId}, using basic info`
      );
      tokenInfo = {
        accountId: tokenAccountId,
        symbol: 'UNKNOWN',
        decimals: 18, // Default decimals
      };
    }

    // Get token balance
    const balance = await getNearTokenBalance(
      provider,
      tokenAccountId,
      accountId,
      tokenInfo.decimals
    );

    if (!balance) {
      console.log(`❌ Failed to get balance for ${tokenAccountId}`);
      return null;
    }

    console.log(
      `💰 ${tokenAccountId}: ${balance.formatted} ${tokenInfo.symbol} (raw: ${balance.raw})`
    );

    return {
      token: tokenInfo,
      balance,
    };
  } catch (error) {
    console.error(`Failed to check token ${tokenAccountId}:`, error);
    return null;
  }
}

// Export bridge-related utilities
export const getBridgeTokenInfo = () => {
  return {
    note: "For testnet, most bridges don't work with mainnet contracts. Use testnet-specific faucets.",
    testnetTokens: {
      'usdc.fakes.testnet': 'Official USDC testnet token',
      'usdt.fakes.testnet': 'Official USDT testnet token',
      'weth.fakes.testnet': 'Official WETH testnet token',
      'wrap.testnet': 'Wrapped NEAR testnet token',
    },
    customTokens: {
      note: 'If you have a specific testnet token contract, use the check-token endpoint to verify it',
      example:
        '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
    },
    mainnetBridge: {
      url: 'https://rainbowbridge.app/',
      note: "Rainbow Bridge is for mainnet only - doesn't work with testnet tokens",
    },
    instructions: [
      '1. For testing, use testnet faucet tokens (*.fakes.testnet)',
      '2. If you have a specific testnet contract, add it to the token list',
      "3. Mainnet bridge tokens won't appear on testnet",
      '4. Use the manual token checker for custom contracts',
    ],
  };
};
