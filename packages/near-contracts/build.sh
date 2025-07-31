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

# Create build directory if it doesn't exist
mkdir -p ./build

# Clean previous builds
echo -e "${YELLOW}🧹 Cleaning previous builds...${NC}"
cargo clean

echo -e "${YELLOW}📦 Building workspace contracts...${NC}"
# Build all contracts from workspace root
cargo build --target wasm32-unknown-unknown --release

# Copy built contracts to build directory
echo -e "${YELLOW}📋 Copying WASM files...${NC}"
cp target/wasm32-unknown-unknown/release/escrow_factory.wasm build/ 2>/dev/null || \
cp target/wasm32-unknown-unknown/release/escrow-factory.wasm build/escrow_factory.wasm 2>/dev/null || \
echo -e "${RED}❌ Could not find escrow_factory.wasm${NC}"

cp target/wasm32-unknown-unknown/release/escrow_dst.wasm build/ 2>/dev/null || \
cp target/wasm32-unknown-unknown/release/escrow-dst.wasm build/escrow_dst.wasm 2>/dev/null || \
echo -e "${RED}❌ Could not find escrow_dst.wasm${NC}"

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo "Generated files:"
ls -la build/*.wasm 2>/dev/null || echo "No WASM files found"
echo ""
echo -e "${YELLOW}🚀 Next steps:${NC}"
echo "1. Deploy factory contract:"
echo "   near deploy --wasmFile build/escrow_factory.wasm --accountId your-factory.testnet"
echo ""
echo "2. Initialize factory:"
echo "   near call your-factory.testnet new '{\"owner\": \"your-account.testnet\", \"rescue_delay\": 2592000}' --accountId your-account.testnet"
echo ""
echo "3. Set escrow code:"
echo "   near call your-factory.testnet set_escrow_code --base64 \$(base64 -i build/escrow_dst.wasm) --accountId your-account.testnet --gas 300000000000000"
echo ""
echo -e "${GREEN}🎉 Ready for cross-chain atomic swaps!${NC}" 