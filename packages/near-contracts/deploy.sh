#!/bin/bash

# NEAR Contract Deployment Script
# Deploys cross-chain contracts to existing NEAR accounts
# Following best practices from https://docs.near.org/smart-contracts/release/deploy

set -e

# Load environment variables from env if it exists
if [ -f "env" ]; then
    echo "📋 Loading configuration from env..."
    source env
    echo "✅ Configuration loaded"
elif [ -f ".env" ]; then
    echo "📋 Loading configuration from .env..."
    source .env
    echo "✅ Configuration loaded"
else
    echo "💡 No env file found. Using environment variables or defaults."
    echo "   To create config file: cp env.example env"
fi

# Configuration
NETWORK="${NEAR_ENV:-testnet}"
FACTORY_ACCOUNT="${FACTORY_ACCOUNT:-}"
RESOLVER_ACCOUNT="${RESOLVER_ACCOUNT:-}"
OWNER_ACCOUNT="${OWNER_ACCOUNT:-}"
RESCUE_DELAY="${RESCUE_DELAY:-86400}"  # 24 hours in seconds (configurable via env)
GAS_AMOUNT="${GAS_AMOUNT:-30000000000000}"  # 30 TGas (configurable via env)

echo "🚀 Deploying NEAR Cross-Chain Contracts on $NETWORK"
echo "Factory Account: $FACTORY_ACCOUNT"
echo "Resolver Account: $RESOLVER_ACCOUNT"  
echo "Owner Account: $OWNER_ACCOUNT"

# Check if required accounts are set
if [ -z "$OWNER_ACCOUNT" ]; then
    echo "❌ OWNER_ACCOUNT is required. Set it in env or as environment variable."
    exit 1
fi

if [ -z "$FACTORY_ACCOUNT" ]; then
    echo "❌ FACTORY_ACCOUNT is required. Set it in env or as environment variable."
    exit 1
fi

if [ -z "$RESOLVER_ACCOUNT" ]; then
    echo "❌ RESOLVER_ACCOUNT is required. Set it in env or as environment variable."
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
        CODE_HASH=$(near state $account 2>/dev/null | grep "code_hash" | cut -d"'" -f2)
        if [[ "$CODE_HASH" == "11111111111111111111111111111111" ]] || [[ -z "$CODE_HASH" ]]; then
            echo "   📭 No contract deployed (will deploy fresh)"
        else
            echo "   📦 Contract already deployed (code_hash: ${CODE_HASH:0:8}...)"
        fi
    fi
done

# Step 3: Build and deploy contracts
echo "🚢 Building and deploying contracts..."

# Build all contracts first
echo "📦 Building all contracts..."
./build.sh

# Deploy template contracts
echo "📦 Deploying escrow template contracts..."
ESCROW_SRC_TEMPLATE="${ESCROW_SRC_TEMPLATE:-escrow-src-template.${OWNER_ACCOUNT}}"
ESCROW_DST_TEMPLATE="${ESCROW_DST_TEMPLATE:-escrow-dst-template.${OWNER_ACCOUNT}}"

# Create template accounts if they don't exist
for template in "$ESCROW_SRC_TEMPLATE" "$ESCROW_DST_TEMPLATE"; do
    if ! near state $template 2>/dev/null >/dev/null; then
        echo "🔧 Creating template account: $template"
        near create-account $template --useFaucet
    fi
done

# Deploy template contracts
echo "📦 Deploying escrow-src template to $ESCROW_SRC_TEMPLATE..."
near deploy $ESCROW_SRC_TEMPLATE target/near/escrow_src/escrow_src.wasm

echo "📦 Deploying escrow-dst template to $ESCROW_DST_TEMPLATE..."
near deploy $ESCROW_DST_TEMPLATE target/near/escrow_dst/escrow_dst.wasm

# Deploy factory contract (if not deployed yet)
FACTORY_CODE_HASH=$(near state $FACTORY_ACCOUNT 2>/dev/null | grep "code_hash" | cut -d"'" -f2)
if [[ "$FACTORY_CODE_HASH" == "11111111111111111111111111111111" ]] || [[ -z "$FACTORY_CODE_HASH" ]]; then
    echo "📦 Deploying escrow-factory to $FACTORY_ACCOUNT..."
    near deploy $FACTORY_ACCOUNT target/near/escrow_factory/escrow_factory.wasm
else
    echo "✅ Factory contract already deployed (code_hash: $FACTORY_CODE_HASH)"
fi

# Deploy resolver contract (if not deployed yet)
RESOLVER_CODE_HASH=$(near state $RESOLVER_ACCOUNT 2>/dev/null | grep "code_hash" | cut -d"'" -f2)
if [[ "$RESOLVER_CODE_HASH" == "11111111111111111111111111111111" ]] || [[ -z "$RESOLVER_CODE_HASH" ]]; then
    echo "📦 Deploying resolver to $RESOLVER_ACCOUNT..."
    near deploy $RESOLVER_ACCOUNT target/near/near_resolver/near_resolver.wasm
else
    echo "✅ Resolver contract already deployed (code_hash: $RESOLVER_CODE_HASH)"
fi

# Step 4: Initialize contracts (only if not already initialized)
echo "🔧 Checking and initializing contracts..."

# Check if factory is already initialized
echo "Checking factory initialization status..."
if FACTORY_STATS=$(near view $FACTORY_ACCOUNT get_stats '{}' 2>/dev/null); then
    echo "⚠️  Factory already initialized, deleting and recreating account..."
    
    # Delete the factory account
    echo "🗑️  Deleting factory account: $FACTORY_ACCOUNT"
    near delete $FACTORY_ACCOUNT $OWNER_ACCOUNT
    
    # Recreate the factory account
    echo "🔧 Creating factory account: $FACTORY_ACCOUNT"
    near create-account $FACTORY_ACCOUNT --useFaucet
    
    # Deploy factory contract
    echo "📦 Deploying escrow-factory to $FACTORY_ACCOUNT..."
    near deploy $FACTORY_ACCOUNT target/near/escrow_factory/escrow_factory.wasm
    
    echo "🔧 Initializing factory..."
    near call $FACTORY_ACCOUNT new "{\"owner\": \"$RESOLVER_ACCOUNT\", \"rescue_delay\": $RESCUE_DELAY, \"escrow_src_template\": \"$ESCROW_SRC_TEMPLATE\", \"escrow_dst_template\": \"$ESCROW_DST_TEMPLATE\"}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Factory recreated and initialized with templates: $ESCROW_SRC_TEMPLATE, $ESCROW_DST_TEMPLATE"
else
    echo "🔧 Initializing factory..."
    near call $FACTORY_ACCOUNT new "{\"owner\": \"$RESOLVER_ACCOUNT\", \"rescue_delay\": $RESCUE_DELAY, \"escrow_src_template\": \"$ESCROW_SRC_TEMPLATE\", \"escrow_dst_template\": \"$ESCROW_DST_TEMPLATE\"}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Factory initialized with templates: $ESCROW_SRC_TEMPLATE, $ESCROW_DST_TEMPLATE"
fi

# Step 5: Initialize resolver (only if not already initialized)
echo "Checking resolver initialization status..."
if near view $RESOLVER_ACCOUNT get_owner '{}' 2>/dev/null >/dev/null; then
    echo "⚠️  Resolver already initialized, deleting and recreating account..."
    
    # Delete the resolver account
    echo "🗑️  Deleting resolver account: $RESOLVER_ACCOUNT"
    near delete $RESOLVER_ACCOUNT $OWNER_ACCOUNT
    
    # Recreate the resolver account
    echo "🔧 Creating resolver account: $RESOLVER_ACCOUNT"
    near create-account $RESOLVER_ACCOUNT --useFaucet
    
    # Deploy resolver contract
    echo "📦 Deploying resolver to $RESOLVER_ACCOUNT..."
    near deploy $RESOLVER_ACCOUNT target/near/near_resolver/near_resolver.wasm
    
    echo "🔧 Initializing resolver..."
    ETH_RESOLVER_ADDRESS="${ETH_RESOLVER_ADDRESS:-0x0000000000000000000000000000000000000000}"
    echo "Using ETH resolver address: $ETH_RESOLVER_ADDRESS"
    near call $RESOLVER_ACCOUNT new "{\"owner\": \"$OWNER_ACCOUNT\", \"escrow_factory\": \"$FACTORY_ACCOUNT\", \"dst_chain_resolver\": \"$ETH_RESOLVER_ADDRESS\"}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Resolver recreated and initialized with owner: $OWNER_ACCOUNT"
else
    echo "🔧 Initializing resolver..."
    ETH_RESOLVER_ADDRESS="${ETH_RESOLVER_ADDRESS:-0x0000000000000000000000000000000000000000}"
    echo "Using ETH resolver address: $ETH_RESOLVER_ADDRESS"
    near call $RESOLVER_ACCOUNT new "{\"owner\": \"$OWNER_ACCOUNT\", \"escrow_factory\": \"$FACTORY_ACCOUNT\", \"dst_chain_resolver\": \"$ETH_RESOLVER_ADDRESS\"}" --accountId $OWNER_ACCOUNT --gas $GAS_AMOUNT
    echo "✅ Resolver initialized with owner: $OWNER_ACCOUNT"
fi

echo "✅ Contract deployment complete!"
echo ""
echo "📋 Deployed Contract Summary:"
echo "=============================="
echo "Network: $NETWORK"
echo "Factory: $FACTORY_ACCOUNT"
echo "Resolver: $RESOLVER_ACCOUNT"
echo "Owner: $OWNER_ACCOUNT"
echo "ETH Resolver: ${ETH_RESOLVER_ADDRESS:-[Not set]}"
echo ""

# Step 6: Verify deployment
echo "🔍 Verifying contract status..."

# Check factory stats
echo "📊 Factory stats:"
near view $FACTORY_ACCOUNT get_stats '{}'

# Check resolver owner
echo "👤 Resolver owner:"
near view $RESOLVER_ACCOUNT get_owner '{}'

echo ""
echo "🎉 Ready for cross-chain atomic swaps!"
echo ""
echo "💡 Next steps:"
echo "1. Update ETH_RESOLVER_ADDRESS in env if needed"
echo "2. Test with examples: cd tests/examples && node near-to-eth-swap.js"
echo "3. Monitor transactions: https://explorer.${NETWORK}.near.org"
echo "4. Re-run this script anytime to upgrade contracts with new code"