import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Simple Header */}
      <header className="border-b border-gray-100 sticky top-0 z-50 bg-white">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-black rounded-sm flex items-center justify-center">
              <span className="text-white font-medium text-lg">1</span>
            </div>
            <span className="text-xl font-medium text-black">1Prime Protocol</span>
          </div>
          <Button variant="outline" className="border-black text-black hover:bg-black hover:text-white">
            Launch App
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-32 px-6">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="text-6xl md:text-8xl font-light leading-tight mb-12 text-black">
            Cross-chain swaps<br />
            <span className="font-normal">900x more efficient</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-16 max-w-2xl mx-auto">
            Lightning-fast atomic swaps between Ethereum and NEAR Protocol. 
            Secure, trustless, real-time.
          </p>

          <Button size="lg" className="bg-black text-white hover:bg-gray-800 text-lg px-12 py-6 rounded-none">
            Start Here
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Features - Minimal */}
      <section className="py-32 px-6 bg-gray-50">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-light text-black mb-4">How it works</h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-16 text-center">
            <div>
              <div className="text-6xl font-light text-black mb-6">1</div>
              <h3 className="text-xl font-medium mb-4 text-black">Atomic Swaps</h3>
              <p className="text-gray-600">Cryptographically secure cross-chain transactions</p>
            </div>
            
            <div>
              <div className="text-6xl font-light text-black mb-6">2</div>
              <h3 className="text-xl font-medium mb-4 text-black">900x Efficiency</h3>
              <p className="text-gray-600">Revolutionary capital efficiency improvement</p>
            </div>
            
            <div>
              <div className="text-6xl font-light text-black mb-6">3</div>
              <h3 className="text-xl font-medium mb-4 text-black">Real-time</h3>
              <p className="text-gray-600">Sub-5 second execution times</p>
            </div>
          </div>
        </div>
      </section>

      {/* Simple Stats */}
      <section className="py-32 px-6">
        <div className="container mx-auto max-w-3xl text-center">
          <div className="grid md:grid-cols-3 gap-16">
            <div>
              <div className="text-5xl font-light text-black mb-2">&lt;5s</div>
              <div className="text-gray-600">Execution time</div>
            </div>
            <div>
              <div className="text-5xl font-light text-black mb-2">900x</div>
              <div className="text-gray-600">More efficient</div>
            </div>
            <div>
              <div className="text-5xl font-light text-black mb-2">5+</div>
              <div className="text-gray-600">Networks</div>
            </div>
          </div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="border-t border-gray-100 py-16 px-6">
        <div className="container mx-auto max-w-4xl">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-3 mb-8 md:mb-0">
              <div className="w-8 h-8 bg-black rounded-sm flex items-center justify-center">
                <span className="text-white font-medium text-lg">1</span>
              </div>
              <span className="text-xl font-medium text-black">1Prime Protocol</span>
            </div>
            
            <div className="flex space-x-8 text-gray-600">
              <a href="#" className="hover:text-black transition-colors">Docs</a>
              <a href="#" className="hover:text-black transition-colors">GitHub</a>
              <a href="#" className="hover:text-black transition-colors">Discord</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}