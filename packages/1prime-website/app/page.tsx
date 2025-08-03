import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowRight,
  Smartphone,
  Zap,
  Globe,
  Shield,
  Lock,
  ArrowDownUp,
  CheckCircle2,
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-black">
      {/* Hero Section */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-6 text-5xl font-bold">
            Cross-Chain Swaps via <span className="underline">Voice</span>
          </h1>
          <p className="text-l mx-auto max-w-2xl text-gray-600">
            Swap tokens between EVM chains and NEAR protocol using 1inch Fusion+
          </p>
          <p className="text-l mx-auto mb-8 max-w-2xl text-gray-600">
            Just say{' '}
            <span className="font-semibold">"Hey Siri, swap my tokens"</span>{' '}
            and we handle the rest.
          </p>

          <div className="mb-8 flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href="https://www.icloud.com/shortcuts/70defed281024a5b9ba729f9594e386c"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                className="bg-black text-white hover:bg-gray-800"
              >
                <Smartphone className="mr-2 h-5 w-5" />
                Import Apple Shortcut
              </Button>
            </a>
            <Link href="/auth/signup">
              <Button size="lg" variant="outline">
                Try Web App
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 mb-10">
            <strong>Quick Start:</strong> Import the shortcut above, then say
            <span className="mx-1 rounded bg-white px-1 py-1 font-mono font-bold">
              "Hey Siri, Login to 1Prime"
            </span>
          </div>
                      <a
              href="https://www.icloud.com/shortcuts/ddc64c83175f438cbf016bcdbabb5dcf"
              target="_blank"
              rel="noopener noreferrer"
              className='mt-10'
            >
              <Button
                size="lg"
                className="bg-gray-800 text-white hover:bg-gray-700"
              >
                <Smartphone className="mr-2 h-5 w-5" />
                Swap Now
              </Button>
            </a>

        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50 px-4 pt-6 pb-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-4 text-center text-2xl font-bold">Why 1Prime?</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="px-4 py-2 text-center">
                <Smartphone className="mx-auto mb-2 h-8 w-8" />
                <h3 className="mb-1 text-base font-semibold">Voice-First UX</h3>
                <p className="text-xs text-gray-600">
                  Swap across chains with Siri.
                  <br />
                  No complex UI or manual signing.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-2 text-center">
                <Zap className="mx-auto mb-2 h-8 w-8" />
                <h3 className="mb-1 text-base font-semibold">
                  Intent-Based Swaps
                </h3>
                <p className="text-xs text-gray-600">
                  1inch Fusion+ powers atomic, MEV-protected swaps.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-2 text-center">
                <Globe className="mx-auto mb-2 h-8 w-8" />
                <h3 className="mb-1 text-base font-semibold">Multi-Chain</h3>
                <p className="text-xs text-gray-600">
                  Swap between Ethereum, Arbitrum, Optimism, and NEAR.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How Cross-Chain Swaps Work */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-3xl font-bold">
            How Cross-Chain Swaps Work
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-gray-600">
            Powered by 1inch Fusion+ protocol with atomic swaps
          </p>

          {/* Visual Flow Diagram */}
          <div className="relative mb-16">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {/* User Section */}
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
                  <Smartphone className="h-10 w-10 text-blue-700" />
                </div>
                <h3 className="mb-1 text-lg font-semibold">You</h3>
                <p className="text-sm text-gray-600">Initiate swap via Siri</p>
              </div>

              {/* Relayer & Fusion+ */}
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
                  <ArrowDownUp className="h-10 w-10 text-purple-700" />
                </div>
                <h3 className="mb-1 text-lg font-semibold">1inch Fusion+</h3>
                <p className="text-sm text-gray-600">
                  Creates atomic swap order
                </p>
              </div>

              {/* Resolver Network */}
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <Shield className="h-10 w-10 text-green-700" />
                </div>
                <h3 className="mb-1 text-lg font-semibold">Resolver Network</h3>
                <p className="text-sm text-gray-600">
                  Executes cross-chain swap
                </p>
              </div>
            </div>

            {/* Connection Arrows */}
            <div className="absolute top-10 right-1/3 left-1/3 hidden md:block">
              <div className="flex items-center justify-between">
                <ArrowRight className="h-6 w-6 text-gray-400" />
                <ArrowRight className="h-6 w-6 text-gray-400" />
              </div>
            </div>
          </div>

          {/* Swap Process Steps */}
          <div className="mx-auto max-w-3xl space-y-6">
            {/* <div className="mb-8 text-center">
              <h3 className="mb-2 text-xl font-semibold">The Swap Process</h3>
              <p className="text-gray-600">
                Trustless, atomic, and MEV-protected
              </p>
            </div> */}

            <div className="space-y-8">
              {/* Step 1 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black font-bold text-white">
                  1
                </div>
                <div className="flex-1">
                  <h4 className="mb-1 font-semibold">
                    Cryptographic Commitment
                  </h4>
                  <p className="ml-1 text-sm text-gray-600">
                    Your device generates a secure random secret and creates a
                    hash commitment. This ensures the swap can only be completed
                    by you.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black font-bold text-white">
                  2
                </div>
                <div className="flex-1">
                  <h4 className="mb-1 font-semibold">
                    1inch Fusion+ Order Creation
                  </h4>
                  <p className="ml-1 text-sm text-gray-600">
                    The relayer uses 1inch Fusion+ SDK to create an atomic swap
                    order with your commitment. This order is MEV-protected and
                    ensures best execution.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black font-bold text-white">
                  3
                </div>
                <div className="flex-1">
                  <h4 className="mb-1 font-semibold">
                    Resolver Network Acceptance
                  </h4>
                  <p className="ml-1 text-sm text-gray-600">
                    Professional resolvers compete to fill your order. They
                    deploy secure escrow contracts on both source and
                    destination chains.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black font-bold text-white">
                  4
                </div>
                <div className="flex-1">
                  <h4 className="mb-1 font-semibold">
                    Secret Reveal & Settlement
                  </h4>
                  <p className="ml-1 text-sm text-gray-600">
                    Once escrows are verified, you reveal your secret to unlock
                    the funds. The resolver completes the cross-chain transfer
                    atomically.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Security Features */}
          {/* <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="border-gray-200">
              <CardContent className="p-6">
                <Lock className="mb-3 h-8 w-8 text-gray-700" />
                <h4 className="mb-2 font-semibold">Atomic Swaps</h4>
                <p className="text-sm text-gray-600">
                  Either the entire swap completes or nothing happens. Your
                  funds are never at risk of partial execution.
                </p>
              </CardContent>
            </Card>
            <Card className="border-gray-200">
              <CardContent className="p-6">
                <CheckCircle2 className="mb-3 h-8 w-8 text-gray-700" />
                <h4 className="mb-2 font-semibold">MEV Protection</h4>
                <p className="text-sm text-gray-600">
                  1inch Fusion+ protocol ensures you get fair execution prices
                  without MEV exploitation.
                </p>
              </CardContent>
            </Card>
          </div> */}
        </div>
      </section>

      {/* CTA */}
      <section className="mt-2 bg-black px-6 py-12 text-white">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-2xl font-bold">
            Ready to try Cross-Chain Swaps via Voice?
          </h2>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href="https://www.icloud.com/shortcuts/70defed281024a5b9ba729f9594e386c"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                className="bg-white text-black hover:bg-gray-100"
              >
                Import Apple Shortcut
              </Button>
            </a>
            <a
              href="https://www.icloud.com/shortcuts/ddc64c83175f438cbf016bcdbabb5dcf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                className="bg-gray-200 text-black hover:bg-gray-300"
              >
                Swap Now
              </Button>
            </a>
            <Link href="/auth/signup">
              <Button
                size="lg"
                variant="outline"
                className="border-white bg-transparent text-white hover:bg-white hover:text-black"
              >
                Create Account
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 px-6 py-8">
        <div className="mx-auto max-w-6xl text-center text-gray-500">
          <p className="italic">
            1Prime • Cross-Chain Swaps via Voice •{' '}
            <a
              href="https://github.com/0xYudhishthra/1prime"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-black"
            >
              GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
