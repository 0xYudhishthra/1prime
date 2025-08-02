'use client';

import { useState, useEffect } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Copy, Wallet, Loader2, RefreshCw } from 'lucide-react';

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

export default function DashboardPage() {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const fetchWalletData = async () => {
    // Check if we're on the client side
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('authToken');
    console.log(
      'Retrieved token:',
      token ? token.substring(0, 20) + '...' : 'null'
    ); // Debug log
    if (!token) {
      setError('No auth token found. Please sign in.');
      setLoading(false);
      return;
    }

    try {
      console.log(
        'Making API call with token:',
        token.substring(0, 20) + '...'
      ); // Debug log
      const response = await fetch(
        'https://shortcut-auth.tanweihup.workers.dev/api/wallet/balances',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
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
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWalletData();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  useEffect(() => {
    fetchWalletData();
  }, []);

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
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Home
              </Button>
            </Link>
            <div className="text-2xl font-bold">1Prime Wallet</div>
          </div>
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
      </header>

      <div className="mx-auto max-w-6xl p-6">
        {/* Summary */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Your Cross-Chain Wallet</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {walletData.summary.totalEvmTokens} EVM Tokens
            </Badge>
            <Badge variant="outline">
              {walletData.summary.totalNearTokens} NEAR Tokens
            </Badge>
            <Badge variant="outline">
              {walletData.summary.evmChainsWithBalance}/
              {walletData.summary.totalEvmChains} EVM Chains Active
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="evm">EVM Chains</TabsTrigger>
            <TabsTrigger value="near">NEAR Protocol</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* EVM Tokens Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  EVM Token Balances
                </CardTitle>
                <CardDescription>
                  Aggregated across {walletData.evm.supportedChains.length}{' '}
                  supported chains
                </CardDescription>
              </CardHeader>
              <CardContent>
                {walletData.evm.totalBalances.length > 0 ? (
                  <div className="space-y-4">
                    {walletData.evm.totalBalances.map((tokenBalance, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div>
                          <div className="font-semibold">
                            {tokenBalance.token.symbol}
                          </div>
                          <div className="text-sm text-gray-500">
                            {tokenBalance.token.name}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {tokenBalance.balance.formatted}
                          </div>
                          <div className="text-sm text-gray-500">
                            Across {tokenBalance.chainBreakdown?.length || 0}{' '}
                            chains
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">
                    No EVM tokens found. Try depositing some testnet tokens.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* NEAR Tokens Summary */}
            <Card>
              <CardHeader>
                <CardTitle>NEAR Token Balances</CardTitle>
              </CardHeader>
              <CardContent>
                {walletData.near.tokens.length > 0 ? (
                  <div className="space-y-4">
                    {walletData.near.tokens.map((tokenBalance, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div>
                          <div className="font-semibold">
                            {tokenBalance.token.symbol}
                          </div>
                          <div className="text-sm text-gray-500">
                            {tokenBalance.token.name}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {tokenBalance.balance.formatted}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">No NEAR tokens found.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evm" className="space-y-6">
            {walletData.evm.chainBreakdown.map((chain) => (
              <Card key={chain.chainId}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {chain.chainName}
                    <Badge variant="outline">Chain ID: {chain.chainId}</Badge>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {chain.address}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {chain.tokens.length > 0 ? (
                    <div className="space-y-3">
                      {chain.tokens.map((tokenBalance, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded bg-gray-50 p-3"
                        >
                          <div>
                            <div className="font-medium">
                              {tokenBalance.token.symbol}
                            </div>
                            <div className="text-sm text-gray-500">
                              {tokenBalance.token.name}
                            </div>
                          </div>
                          <div className="font-semibold">
                            {tokenBalance.balance.formatted}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No tokens on this chain.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="near">
            <Card>
              <CardHeader>
                <CardTitle>NEAR Protocol</CardTitle>
                <CardDescription className="font-mono text-xs">
                  {walletData.near.accountId}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {walletData.near.tokens.length > 0 ? (
                  <div className="space-y-3">
                    {walletData.near.tokens.map((tokenBalance, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded bg-gray-50 p-3"
                      >
                        <div>
                          <div className="font-medium">
                            {tokenBalance.token.symbol}
                          </div>
                          <div className="text-sm text-gray-500">
                            {tokenBalance.token.name}
                          </div>
                          <div className="font-mono text-xs text-gray-400">
                            {tokenBalance.token.accountId}
                          </div>
                        </div>
                        <div className="font-semibold">
                          {tokenBalance.balance.formatted}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">No NEAR tokens found.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="addresses" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>EVM Smart Wallet</CardTitle>
                <CardDescription>
                  Same address across all supported EVM chains. Send funds here
                  for best experience.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 rounded bg-gray-50 p-3 font-mono text-sm">
                  <span className="flex-1">{walletData.evm.address}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(walletData.evm.address)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-4">
                  <h4 className="mb-2 font-medium">Supported Chains:</h4>
                  <div className="flex flex-wrap gap-2">
                    {walletData.evm.supportedChains.map((chain) => (
                      <Badge key={chain.chainId} variant="outline">
                        {chain.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>NEAR Account</CardTitle>
                <CardDescription>
                  Your NEAR protocol account for cross-chain swaps.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 rounded bg-gray-50 p-3 font-mono text-sm">
                  <span className="flex-1">{walletData.near.accountId}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(walletData.near.accountId)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
