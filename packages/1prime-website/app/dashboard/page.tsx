'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Copy,
  Wallet,
  Loader2,
  RefreshCw,
  PieChart,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';

interface TokenBalance {
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    chainId?: number;
    accountId?: string;
  };
  balance: {
    raw: string;
    formatted: string;
  };
  chainBreakdown?: Array<{
    chainId: number;
    chainName: string;
    balance: {
      raw: string;
      formatted: string;
    };
  }>;
}

interface WalletData {
  evm: {
    address: string;
    totalBalances: TokenBalance[];
    chainBreakdown: Array<{
      chainId: number;
      chainName: string;
      address: string;
      tokens: TokenBalance[];
    }>;
    supportedChains: Array<{
      chainId: number;
      name: string;
    }>;
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

function DashboardPage() {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { token, isAuthenticated, logout } = useAuth();

  const fetchWalletData = useCallback(async () => {
    if (!token) {
      setError('No auth token found. Please sign in.');
      setLoading(false);
      return;
    }

    console.log(
      'Retrieved token:',
      token ? token.substring(0, 20) + '...' : 'null',
    ); // Debug log

    try {
      console.log(
        'Making API call with token:',
        token.substring(0, 20) + '...',
      ); // Debug log
      const response = await fetch(
        'https://shortcut-auth.tanweihup.workers.dev/api/wallet/balances',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('Response status:', response.status); // Debug log
      if (response.ok) {
        const data = await response.json();
        setWalletData(data);
        setError('');
      } else {
        // If unauthorized, clear the token and redirect to sign in
        if (response.status === 401) {
          console.log('401 Unauthorized - clearing token and redirecting');
          localStorage.removeItem('authToken');
          router.push('/auth/signin');
          return;
        } else {
          try {
            const errorData = await response.json();
            setError(errorData.error || 'Failed to fetch wallet data');
          } catch {
            setError(`HTTP ${response.status}: Failed to fetch wallet data`);
          }
        }
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, router]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWalletData();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  useEffect(() => {
    fetchWalletData();
  }, [fetchWalletData]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
          <p>Loading your wallet...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-gray-600">{error}</p>
            <div className="flex justify-center gap-2">
              <Button onClick={fetchWalletData}>Try Again</Button>
              <Link href="/auth/signin">
                <Button variant="outline">Sign In</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!walletData) return null;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header with Action Buttons */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mt-2 text-3xl font-bold">1Prime Wallet</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/deposit">
              <Button variant="outline" size="sm">
                <Wallet className="mr-2 h-4 w-4" />
                Deposit
              </Button>
            </Link>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* All Token Balances */}
        <div className="space-y-6">
          {/* EVM Chains */}
          <Card>
            <CardContent className="">
              <div className="space-y-6">
                {/* Ethereum Sepolia */}
                {walletData.evm.chainBreakdown
                  .filter(
                    (chain) =>
                      chain.chainName.includes('Ethereum Sepolia') ||
                      (chain.chainName.includes('Sepolia') &&
                        !chain.chainName.includes('Arbitrum') &&
                        !chain.chainName.includes('Optimism')),
                  )
                  .map((chain) => (
                    <div key={chain.chainId} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">
                          {chain.chainName}
                        </h3>
                        <Badge variant="outline">
                          Chain ID: {chain.chainId}
                        </Badge>
                      </div>
                      {chain.tokens.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {chain.tokens.map((tokenBalance, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"
                            >
                              <div>
                                <div className="font-medium">
                                  {tokenBalance.token.symbol}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold">
                                  {parseFloat(
                                    tokenBalance.balance.formatted,
                                  ).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No tokens on this chain
                        </p>
                      )}
                    </div>
                  ))}

                {/* Arbitrum Sepolia */}
                {walletData.evm.chainBreakdown
                  .filter((chain) =>
                    chain.chainName.includes('Arbitrum Sepolia'),
                  )
                  .map((chain) => (
                    <div key={chain.chainId} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">
                          {chain.chainName}
                        </h3>
                        <Badge variant="outline">
                          Chain ID: {chain.chainId}
                        </Badge>
                      </div>
                      {chain.tokens.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {chain.tokens.map((tokenBalance, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"
                            >
                              <div>
                                <div className="font-medium">
                                  {tokenBalance.token.symbol}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold">
                                  {parseFloat(
                                    tokenBalance.balance.formatted,
                                  ).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No tokens on this chain
                        </p>
                      )}
                    </div>
                  ))}

                {/* Optimism Sepolia */}
                {walletData.evm.chainBreakdown
                  .filter((chain) =>
                    chain.chainName.includes('Optimism Sepolia'),
                  )
                  .map((chain) => (
                    <div key={chain.chainId} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">
                          {chain.chainName}
                        </h3>
                        <Badge variant="outline">
                          Chain ID: {chain.chainId}
                        </Badge>
                      </div>
                      {chain.tokens.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {chain.tokens.map((tokenBalance, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"
                            >
                              <div>
                                <div className="font-medium">
                                  {tokenBalance.token.symbol}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold">
                                  {parseFloat(
                                    tokenBalance.balance.formatted,
                                  ).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No tokens on this chain
                        </p>
                      )}
                    </div>
                  ))}

                {/* Other EVM Chains */}
                {walletData.evm.chainBreakdown
                  .filter(
                    (chain) =>
                      !chain.chainName.includes('Ethereum Sepolia') &&
                      !chain.chainName.includes('Arbitrum Sepolia') &&
                      !chain.chainName.includes('Optimism Sepolia'),
                  )
                  .map((chain) => (
                    <div key={chain.chainId} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">
                          {chain.chainName}
                        </h3>
                        <Badge variant="outline">
                          Chain ID: {chain.chainId}
                        </Badge>
                      </div>
                      {chain.tokens.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {chain.tokens.map((tokenBalance, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"
                            >
                              <div>
                                <div className="font-medium">
                                  {tokenBalance.token.symbol}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold">
                                  {parseFloat(
                                    tokenBalance.balance.formatted,
                                  ).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No tokens on this chain
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* NEAR Protocol */}
          <Card>
            <CardContent className="">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">NEAR Protocol</h3>
                  <Badge variant="outline">NEAR</Badge>
                </div>
                {walletData.near.tokens.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {walletData.near.tokens.map((tokenBalance, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border bg-gray-50 p-3"
                      >
                        <div>
                          <div className="font-medium">
                            {tokenBalance.token.symbol}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {parseFloat(tokenBalance.balance.formatted).toFixed(
                              2,
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No NEAR tokens found</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPageWrapper() {
  return (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  );
}
