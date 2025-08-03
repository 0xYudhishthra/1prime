'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
  Check,
  Wallet,
  Loader2,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';

interface WalletAddresses {
  evm: {
    smartWallet: {
      address: string;
      note: string;
    };
    eoa: {
      address: string;
      note: string;
    };
  };
  near: {
    accountId: string;
  };
  supportedChains: Array<{
    chainId: number;
    name: string;
  }>;
  usage: {
    deposits: string;
    transactions: string;
  };
}

function DepositPageContent() {
  const { token } = useAuth();
  const [addresses, setAddresses] = useState<WalletAddresses | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  useEffect(() => {
    const fetchAddresses = async () => {
      if (!token) return;

      try {
        const response = await fetch(
          'https://shortcut-auth.tanweihup.workers.dev/api/wallet/addresses',
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          throw new Error('Failed to fetch wallet addresses');
        }

        const data = await response.json();
        setAddresses(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchAddresses();
  }, [token]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(text);
      // Reset the check mark after 2 seconds
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-black">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* <div className="mb-6 flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Wallet
              </Button>
            </Link>
            <h1 className="text-3xl font-bold">Deposit Tokens</h1>
          </div> */}

          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !addresses) {
    return (
      <div className="min-h-screen bg-white text-black">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* <div className="mb-6 flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Wallet
              </Button>
            </Link>
            <h1 className="text-3xl font-bold">Deposit Tokens</h1>
          </div> */}

          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-600">
                {error || 'Failed to load wallet addresses'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center gap-4">
          {/* <Link href="/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Wallet
            </Button>
          </Link> */}
          <h1 className="text-3xl font-bold">Deposit Tokens</h1>
        </div>

        <div className="mb-8 rounded-lg bg-blue-50 p-4">
          <p className="text-blue-800">
            <strong>Instructions:</strong> Send tokens to the addresses below to
            add them to your wallet.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* EVM Address Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                EVM Smart Wallet
              </CardTitle>
              <CardDescription>
                Universal address for all EVM chains
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-[-10px] space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">
                  Address
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 p-2 font-mono text-xs">
                    {addresses.evm.smartWallet.address}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyToClipboard(addresses.evm.smartWallet.address)
                    }
                  >
                    {copiedAddress === addresses.evm.smartWallet.address ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">
                  Supported Chains
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {addresses.supportedChains.map((chain) => (
                    <Badge key={chain.chainId} variant="secondary">
                      {chain.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* NEAR Address Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                NEAR Protocol
              </CardTitle>
              <CardDescription>NEAR account for NEP-141 tokens</CardDescription>
            </CardHeader>
            <CardContent className="mt-[-10px] space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">
                  Account ID
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 p-2 font-mono text-xs">
                    {addresses.near.accountId}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(addresses.near.accountId)}
                  >
                    {copiedAddress === addresses.near.accountId ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">
                  Supported Tokens
                </label>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">NEAR</Badge>
                  <Badge variant="secondary">NEP-141 Tokens</Badge>
                  <Badge variant="secondary">Bridged Tokens</Badge>
                </div>
              </div> */}
            </CardContent>
          </Card>
        </div>

        {/* Apple Shortcut Section */}
        <Card className="mt-8">
          {/* <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Voice-Controlled Deposits
            </CardTitle>
            <CardDescription>
              Add the Apple Shortcut to easily access your deposit addresses
              with Siri
            </CardDescription>
          </CardHeader> */}
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Deposit Tokens Shortcut</p>
                <p className="text-sm text-gray-600">
                  Say "Hey Siri, Deposit Tokens" to quickly access your deposit
                  addresses
                </p>
              </div>
              <a
                href="https://www.icloud.com/shortcuts/3912a4b990e64b728d940b264b393d6a"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button className="bg-black text-white hover:bg-gray-800">
                  <Smartphone className="mr-2 h-4 w-4" />
                  Add to Shortcuts
                  {/* <ExternalLink className="ml-2 h-4 w-4" /> */}
                </Button>
              </a>
            </div>

            <div className="rounded bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                <strong>How it works:</strong>
              </p>
              <ol className="mt-2 ml-2 space-y-1 text-sm text-gray-600">
                <li>1. Tap "Add to Shortcuts" above</li>
                <li>2. Follow the setup instructions</li>
                <li>3. Say "Hey Siri, Deposit Tokens" anytime</li>
                <li>
                  4. Your deposit address will be copied to your clipboard
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DepositPage() {
  return (
    <ProtectedRoute>
      <DepositPageContent />
    </ProtectedRoute>
  );
}
