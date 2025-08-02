#!/bin/bash

# NEAR Cross-Chain Escrow Testnet Test Runner
# This script builds contracts and runs integration tests on NEAR testnet

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 NEAR Cross-Chain Escrow Testnet Tests${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"

# Check prerequisites
echo -e "\n${BLUE}🔍 Checking Prerequisites...${NC}"

# Check if near CLI is installed
if ! command -v near &> /dev/null; then
    echo -e "${RED}❌ NEAR CLI not found${NC}"
    echo -e "${YELLOW}Install with: npm install -g near-cli${NC}"
    exit 1
fi
echo -e "${GREEN}✅ NEAR CLI found${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo -e "${YELLOW}Install Node.js from: https://nodejs.org${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js found${NC}"

# Check for testnet credentials
NEAR_CREDS_DIR="$HOME/.near-credentials/testnet"
if [ ! -d "$NEAR_CREDS_DIR" ]; then
    echo -e "${YELLOW}⚠️  No testnet credentials found${NC}"
    echo -e "${YELLOW}Create accounts at: https://wallet.testnet.near.org${NC}"
    echo -e "${YELLOW}Fund them at: https://near-faucet.io/${NC}"
fi

# Environment variables setup
echo -e "\n${BLUE}🔧 Environment Setup${NC}"
echo -e "${YELLOW}You can set these environment variables to use custom accounts:${NC}"
echo -e "${YELLOW}  export FACTORY_ACCOUNT=\"your-factory.testnet\"${NC}"
echo -e "${YELLOW}  export RESOLVER_ACCOUNT=\"your-resolver.testnet\"${NC}"
echo -e "${YELLOW}  export MAKER_ACCOUNT=\"your-maker.testnet\"${NC}"
echo -e "${YELLOW}  export TAKER_ACCOUNT=\"your-taker.testnet\"${NC}"

# Show current config
echo -e "\n${BLUE}Current Configuration:${NC}"
echo -e "  Factory: ${FACTORY_ACCOUNT:-escrow-factory.testnet}"
echo -e "  Resolver: ${RESOLVER_ACCOUNT:-escrow-resolver.testnet}"
echo -e "  Maker: ${MAKER_ACCOUNT:-maker-test.testnet}"
echo -e "  Taker: ${TAKER_ACCOUNT:-taker-test.testnet}"

# Build contracts
echo -e "\n${BLUE}🔨 Building Contracts...${NC}"
cd ../
if [ -f "./build.sh" ]; then
    ./build.sh
    echo -e "${GREEN}✅ Contracts built successfully${NC}"
else
    echo -e "${RED}❌ Build script not found${NC}"
    echo -e "${YELLOW}Please run from the near-contracts directory${NC}"
    exit 1
fi

# Run integration tests
echo -e "\n${BLUE}🚀 Running Integration Tests...${NC}"
cd tests/
node integration-tests.js

# Check exit code
if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests completed successfully!${NC}"
    echo -e "\n${BLUE}📋 Next Steps:${NC}"
    echo -e "${YELLOW}  1. Check deployed contracts on testnet explorer${NC}"
    echo -e "${YELLOW}  2. Run examples: cd examples && node near-to-eth-swap.js${NC}"
    echo -e "${YELLOW}  3. Monitor transactions at: https://explorer.testnet.near.org${NC}"
    
    echo -e "\n${BLUE}🔗 Useful Links:${NC}"
    echo -e "  • Testnet Explorer: https://explorer.testnet.near.org"
    echo -e "  • Testnet Wallet: https://wallet.testnet.near.org"
    echo -e "  • Get Testnet NEAR: https://near-faucet.io/"
else
    echo -e "\n${RED}❌ Tests failed. Check the output above for details.${NC}"
    exit 1
fi