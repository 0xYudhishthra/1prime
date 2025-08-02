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
cargo near build non-reproducible-wasm

cd ../escrow-dst  
echo -e "${YELLOW}Building escrow-dst...${NC}"
cargo near build non-reproducible-wasm

cd ../escrow-src
echo -e "${YELLOW}Building escrow-src...${NC}"
cargo near build non-reproducible-wasm

cd ../resolver
echo -e "${YELLOW}Building resolver...${NC}"
cargo near build non-reproducible-wasm

cd ..

echo -e "${YELLOW}📋 Organizing WASM files...${NC}"
# Create build directory and copy WASM files from target/near/ directories (cargo near build output)
mkdir -p ./build

# Copy all the built WASM files from workspace target/near/ subdirectories
cp target/near/escrow_factory/escrow_factory.wasm build/ 2>/dev/null && \
echo -e "${GREEN}✅ Copied escrow_factory.wasm${NC}" || \
echo -e "${RED}❌ Could not find escrow_factory.wasm${NC}"

cp target/near/escrow_dst/escrow_dst.wasm build/ 2>/dev/null && \
echo -e "${GREEN}✅ Copied escrow_dst.wasm${NC}" || \
echo -e "${RED}❌ Could not find escrow_dst.wasm${NC}"

cp target/near/escrow_src/escrow_src.wasm build/ 2>/dev/null && \
echo -e "${GREEN}✅ Copied escrow_src.wasm${NC}" || \
echo -e "${RED}❌ Could not find escrow_src.wasm${NC}"

cp target/near/near_resolver/near_resolver.wasm build/ 2>/dev/null && \
echo -e "${GREEN}✅ Copied near_resolver.wasm${NC}" || \
echo -e "${RED}❌ Could not find near_resolver.wasm${NC}"

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo "Generated files:"
ls -la build/*.wasm 2>/dev/null || echo "No WASM files found"
echo ""
echo -e "${YELLOW}🚀 Next steps (following official NEAR CLI format):${NC}"
echo "1. Create testnet accounts (if needed):"
echo "   near create-account your-factory.testnet --useFaucet"
echo "   near create-account your-resolver.testnet --useFaucet"
echo ""
echo "2. Deploy factory contract:"
echo "   near deploy your-factory.testnet build/escrow_factory.wasm"
echo "   # Or full version:"
echo "   # near contract deploy your-factory.testnet use-file build/escrow_factory.wasm without-init-call network-config testnet sign-with-keychain send"
echo ""
echo "3. Initialize factory:"
echo "   near call your-factory.testnet new '{\"owner\": \"your-resolver.testnet\", \"rescue_delay\": 1800}' --accountId your-factory.testnet"
echo ""
echo "4. Deploy resolver contract:"
echo "   near deploy your-resolver.testnet build/near_resolver.wasm"
echo ""
echo "5. Initialize resolver:"
echo "   near call your-resolver.testnet new '{\"escrow_factory\": \"your-factory.testnet\", \"owner\": \"your-resolver.testnet\"}' --accountId your-resolver.testnet"
echo ""
echo "6. Set escrow WASM codes:"
echo "   near call your-factory.testnet set_escrow_dst_code '{\"escrow_code\": \"'\$(base64 -i build/escrow_dst.wasm)'\"}' --accountId your-resolver.testnet"
echo "   near call your-factory.testnet set_escrow_src_code '{\"escrow_code\": \"'\$(base64 -i build/escrow_src.wasm)'\"}' --accountId your-resolver.testnet"
echo ""
echo -e "${GREEN}🎉 Ready for cross-chain atomic swaps!${NC}" 