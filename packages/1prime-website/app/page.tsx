import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Smartphone, Zap, Globe } from 'lucide-react';

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

          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
            <strong>Quick Start:</strong> Import the shortcut above, then say
            <span className="mx-1 rounded bg-white px-1 py-1 font-mono font-bold">
              "Hey Siri, Login to 1Prime"
            </span>
          </div>
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

      {/* Technical Flow */}
      {/* <section className="px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-center text-3xl font-bold">
            How It Works Under The Hood
          </h2>
          <div className="space-y-6">
            {[
              {
                step: 1,
                title: 'Generate Random Number',
                desc: 'Frontend creates cryptographic randomness',
                actor: 'Frontend',
              },
              {
                step: 2,
                title: 'Hash with Keccak-256',
                desc: "User's wallet signs the hash commitment",
                actor: 'Frontend',
              },
              {
                step: 3,
                title: 'Generate Order Details',
                desc: 'Send user address, amount, tokens, chains, and hash',
                actor: 'Frontend',
              },
              {
                step: 4,
                title: 'Create Fusion+ Order',
                desc: 'Relayer patches 1inch SDK to create atomic swap order',
                actor: 'Relayer',
              },
              {
                step: 5,
                title: 'Return Order Hash',
                desc: 'Fusion+ order returned with tracking hash',
                actor: 'Relayer',
              },
              {
                step: 6,
                title: 'Sign Transaction',
                desc: 'Smart wallet signs the Fusion+ order',
                actor: 'Frontend',
              },
              {
                step: 7,
                title: 'Submit to Relayer',
                desc: 'Signed order sent back to relayer network',
                actor: 'Frontend',
              },
              {
                step: 8,
                title: 'Accept Order',
                desc: 'Resolver backend polls and confirms the order',
                actor: 'Resolver',
              },
              {
                step: 9,
                title: 'Poll Order Status',
                desc: 'Frontend checks order status every 2 seconds',
                actor: 'Frontend',
              },
              {
                step: 10,
                title: 'Deploy Escrows',
                desc: 'Resolver deploys source and destination chain escrows',
                actor: 'Resolver',
              },
              {
                step: 11,
                title: 'Wait for Secret',
                desc: 'Relayer validates contracts and updates state',
                actor: 'Relayer',
              },
              {
                step: 12,
                title: 'Reveal Secret',
                desc: 'Frontend sends original random number to unlock',
                actor: 'Frontend',
              },
              {
                step: 13,
                title: 'Unlock Funds',
                desc: 'Resolver broadcasts to network and releases funds',
                actor: 'Resolver',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="flex gap-4 rounded-lg border border-gray-200 p-4"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
                  {item.step}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="font-semibold">{item.title}</h3>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs">
                      {item.actor}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section> */}

      {/* CTA */}
      <section className="bg-black px-6 py-12 text-white">
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
