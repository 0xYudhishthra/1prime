#!/bin/bash

# Build script for NEAR cross-chain escrow contracts
set -e

echo "🔨 Building NEAR Cross-Chain Escrow Contracts..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if wasm32-unknown-unknown target is installed
if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    echo -e "${YELLOW}⚠️  Installing wasm32-unknown-unknown target...${NC}"
    rustup target add wasm32-unknown-unknown
fi

# Check if cargo-near is installed
if ! command -v cargo-near &> /dev/null; then
    echo -e "${YELLOW}⚠️  Installing cargo-near...${NC}"
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
fi

# Clean previous builds
echo -e "${YELLOW}🧹 Cleaning previous builds...${NC}"
cargo clean

echo -e "${YELLOW}📦 Building all contracts with cargo near build...${NC}"

# Build each contract using cargo near build non-reproducible-wasm (for development)
cd escrow-factory
echo -e "${YELLOW}Building escrow-factory...${NC}"
cargo near build reproducible-wasm

cd ../escrow-dst  
echo -e "${YELLOW}Building escrow-dst (first pass)...${NC}"
cargo near build reproducible-wasm
echo -e "${YELLOW}Building escrow-dst (second pass with WASM)...${NC}"
cargo near build reproducible-wasm --features include-wasm

cd ../escrow-src
echo -e "${YELLOW}Building escrow-src (first pass)...${NC}"
cargo near build reproducible-wasm
echo -e "${YELLOW}Building escrow-src (second pass with WASM)...${NC}"
cargo near build reproducible-wasm --features include-wasm

cd ../resolver
echo -e "${YELLOW}Building resolver...${NC}"
cargo near build reproducible-wasm

cd ..

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo "Generated WASM files in target/near/ directories:"
ls -la target/near/*/*.wasm 2>/dev/null || echo "No WASM files found"
echo ""
echo -e "${YELLOW}🚀 Next steps:${NC}"
echo "1. Create testnet accounts (if needed):"
echo "   near create-account your-factory.testnet --useFaucet"
echo "   near create-account your-resolver.testnet --useFaucet"
echo ""
echo "2. Use the deployment script:"
echo "   cp env.example env"
echo "   # Edit env with your account names"
echo "   ./deploy.sh"
echo ""
echo "Or deploy manually:"
echo "2. Deploy factory contract:"
echo "   near deploy your-factory.testnet target/near/escrow_factory/escrow_factory.wasm"
echo ""
echo "3. Deploy resolver contract:"
echo "   near deploy your-resolver.testnet target/near/resolver/resolver.wasm"
echo ""
echo "4. Set escrow WASM codes:"
echo "   near call your-factory.testnet set_escrow_dst_code '{\"escrow_code\": \"'\$(base64 target/near/escrow_dst/escrow_dst.wasm)'\"}' --accountId your-resolver.testnet"
echo "   near call your-factory.testnet set_escrow_src_code '{\"escrow_code\": \"'\$(base64 target/near/escrow_src/escrow_src.wasm)'\"}' --accountId your-resolver.testnet"
echo ""
echo -e "${GREEN}🎉 Ready for cross-chain atomic swaps!${NC}" 