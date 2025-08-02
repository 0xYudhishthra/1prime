#!/bin/bash

# NEAR Contract Upgrade Script
# Upgrades cross-chain contracts to existing NEAR accounts
# Following best practices from https://docs.near.org/smart-contracts/release/deploy

set -e

# Load environment variables from deployment.env if it exists
if [ -f "deployment.env" ]; then
    echo "📋 Loading configuration from deployment.env..."
    source deployment.env
    echo "✅ Configuration loaded"
elif [ -f ".env" ]; then
    echo "📋 Loading configuration from .env..."
    source .env
    echo "✅ Configuration loaded"
else
    echo "💡 No deployment.env file found. Using environment variables or defaults."
    echo "   To create config file: cp deployment.env.example deployment.env"
fi

# Configuration
NETWORK="${NEAR_ENV:-testnet}"
FACTORY_ACCOUNT="${FACTORY_ACCOUNT:-}"
RESOLVER_ACCOUNT="${RESOLVER_ACCOUNT:-}"
OWNER_ACCOUNT="${OWNER_ACCOUNT:-}"
RESCUE_DELAY="${RESCUE_DELAY:-86400}"  # 24 hours in seconds (configurable via env)
GAS_AMOUNT="${GAS_AMOUNT:-30000000000000}"  # 30 TGas (configurable via env)

echo "🔄 Upgrading NEAR Cross-Chain Contracts on $NETWORK"
echo "Factory Account: $FACTORY_ACCOUNT"
echo "Resolver Account: $RESOLVER_ACCOUNT"  
echo "Owner Account: $OWNER_ACCOUNT"

# Check if required accounts are set
if [ -z "$OWNER_ACCOUNT" ]; then
    echo "❌ OWNER_ACCOUNT is required. Set it in deployment.env or as environment variable."
    exit 1
fi

if [ -z "$FACTORY_ACCOUNT" ]; then
    echo "❌ FACTORY_ACCOUNT is required. Set it in deployment.env or as environment variable."
    exit 1
fi

if [ -z "$RESOLVER_ACCOUNT" ]; then
    echo "❌ RESOLVER_ACCOUNT is required. Set it in deployment.env or as environment variable."
    exit 1
fi

# Step 1: Verify prerequisites
echo "🔍 Checking prerequisites..."

# Check cargo-near
if ! command -v cargo-near &> /dev/null; then
    echo "📦 Installing cargo-near..."
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
fi

# Check NEAR CLI
if ! command -v near &> /dev/null; then
    echo "❌ NEAR CLI not found. Please install with: npm install -g near-cli"
    exit 1
fi

# Step 2: Verify accounts exist and check contract status
echo "🔍 Verifying accounts and checking contract status..."

# Check owner account (no contract deployment needed)
if ! near state $OWNER_ACCOUNT 2>/dev/null >/dev/null; then
    echo "❌ Owner account does not exist: $OWNER_ACCOUNT"
    echo "Please create it first: near create-account $OWNER_ACCOUNT --useFaucet"
    exit 1
else
    echo "✅ Owner account exists: $OWNER_ACCOUNT"
fi

# Check contract accounts (factory and resolver)
for account in "$FACTORY_ACCOUNT" "$RESOLVER_ACCOUNT"; do
    if ! near state $account 2>/dev/null >/dev/null; then
        echo "❌ Contract account does not exist: $account"
        echo "Please create it first: near create-account $account --useFaucet"
        exit 1
    else
        echo "✅ Contract account exists: $account"
        
        # Check if account has a contract deployed
        if near view $account get_owner '{}' 2>/dev/null >/dev/null || near view $account get_stats '{}' 2>/dev/null >/dev/null; then
            echo "   📦 Contract already deployed (will upgrade)"
        else
            echo "   📭 No contract deployed (will deploy fresh)"
        fi
    fi
done

# Step 3: Build and deploy contracts
echo "🚢 Building and deploying contracts..."
cd ..

# Build and deploy factory
echo "📦 Building and deploying escrow-factory to $FACTORY_ACCOUNT..."
cd escrow-factory
cargo near build non-reproducible-wasm
near deploy $FACTORY_ACCOUNT ../target/near/escrow_factory/escrow_factory.wasm

# Build and deploy resolver
echo "📦 Building and deploying resolver to $RESOLVER_ACCOUNT..."
cd ../resolver
cargo near build non-reproducible-wasm
near deploy $RESOLVER_ACCOUNT ../target/near/resolver/resolver.wasm

# Go back to contracts root for the rest of the script
cd ..

# Step 4: Initialize contracts (only if not already initialized)
echo "🔧 Checking and initializing contracts..."

# Check if factory is already initialized
echo "Checking factory initialization status..."
if near view $FACTORY_ACCOUNT get_owner '{}' 2>/dev/null >/dev/null; then
    echo "✅ Factory already initialized"
    FACTORY_OWNER=$(near view $FACTORY_ACCOUNT get_owner '{}' 2>/dev/null | tail -1 | tr -d "'\"")
    echo "   Current owner: $FACTORY_OWNER"
else
    echo "🔧 Initializing factory..."
    near call $FACTORY_ACCOUNT new "{\"owner\": \"$RESOLVER_ACCOUNT\", \"rescue_delay\": $RESCUE_DELAY}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Factory initialized with owner: $RESOLVER_ACCOUNT"
fi

# Step 5: Build and upload escrow contracts to factory
echo "📦 Building escrow contracts for WASM code upload..."

# Build destination escrow
echo "Building escrow-dst..."
cd escrow-dst
cargo near build non-reproducible-wasm
cd ..

# Build source escrow  
echo "Building escrow-src..."
cd escrow-src
cargo near build non-reproducible-wasm
cd ..

# Upload escrow codes to factory (always update these)
echo "📤 Uploading escrow WASM codes to factory..."

# Set destination escrow code on factory
echo "Uploading destination escrow code..."
ESCROW_DST_CODE=$(cat escrow-dst/target/near/escrow_dst/escrow_dst.wasm | base64)
near call $FACTORY_ACCOUNT set_escrow_dst_code "{\"escrow_code\": \"$ESCROW_DST_CODE\"}" --accountId $RESOLVER_ACCOUNT --gas $GAS_AMOUNT

# Set source escrow code on factory
echo "Uploading source escrow code..."
ESCROW_SRC_CODE=$(cat escrow-src/target/near/escrow_src/escrow_src.wasm | base64)
near call $FACTORY_ACCOUNT set_escrow_src_code "{\"escrow_code\": \"$ESCROW_SRC_CODE\"}" --accountId $RESOLVER_ACCOUNT --gas $GAS_AMOUNT

# Step 6: Initialize resolver (only if not already initialized)
echo "Checking resolver initialization status..."
if near view $RESOLVER_ACCOUNT get_owner '{}' 2>/dev/null >/dev/null; then
    echo "✅ Resolver already initialized"
    RESOLVER_OWNER=$(near view $RESOLVER_ACCOUNT get_owner '{}' 2>/dev/null | tail -1 | tr -d "'\"")
    echo "   Current owner: $RESOLVER_OWNER"
else
    echo "🔧 Initializing resolver..."
    ETH_RESOLVER_ADDRESS="${ETH_RESOLVER_ADDRESS:-0x0000000000000000000000000000000000000000}"
    echo "Using ETH resolver address: $ETH_RESOLVER_ADDRESS"
    near call $RESOLVER_ACCOUNT new "{\"owner\": \"$OWNER_ACCOUNT\", \"escrow_factory\": \"$FACTORY_ACCOUNT\", \"dst_chain_resolver\": \"$ETH_RESOLVER_ADDRESS\"}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Resolver initialized with owner: $OWNER_ACCOUNT"
fi

echo "✅ Contract upgrade complete!"
echo ""
echo "📋 Upgraded Contract Summary:"
echo "=============================="
echo "Network: $NETWORK"
echo "Factory: $FACTORY_ACCOUNT"
echo "Resolver: $RESOLVER_ACCOUNT"
echo "Owner: $OWNER_ACCOUNT"
echo "ETH Resolver: ${ETH_RESOLVER_ADDRESS:-[Not set]}"
echo ""

# Step 7: Verify upgrade
echo "🔍 Verifying contract status..."

# Check factory stats
echo "📊 Factory stats:"
near view $FACTORY_ACCOUNT get_stats '{}'

# Check factory owner
echo "👤 Factory owner:"
near view $FACTORY_ACCOUNT get_owner '{}'

# Check resolver owner
echo "👤 Resolver owner:"
near view $RESOLVER_ACCOUNT get_owner '{}'

echo ""
echo "🎉 Ready for cross-chain atomic swaps!"
echo ""
echo "💡 Next steps:"
echo "1. Update ETH_RESOLVER_ADDRESS in deployment.env if needed"
echo "2. Test with examples: cd ../tests/examples && node near-to-eth-swap.js"
echo "3. Monitor transactions: https://explorer.${NETWORK}.near.org"
echo "4. Re-run this script anytime to upgrade contracts with new code" 