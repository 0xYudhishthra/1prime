#!/bin/bash

# NEAR Contract Deployment Script
# Following best practices from https://docs.near.org/smart-contracts/release/deploy

set -e

# Configuration
NETWORK="${NEAR_ENV:-testnet}"
FACTORY_ACCOUNT="escrow-factory.$NETWORK"
RESOLVER_ACCOUNT="resolver.$NETWORK"
OWNER_ACCOUNT="${OWNER_ACCOUNT:-your-account.$NETWORK}"
RESCUE_DELAY=86400  # 24 hours in seconds

echo "🚀 Deploying NEAR Cross-Chain Contracts to $NETWORK"

# Step 1: Build contracts
echo "📦 Building contracts..."
cd ../escrow-factory
cargo near build --release

cd ../resolver  
cargo near build --release

cd ../escrow-dst
cargo near build --release

cd ../escrow-src
cargo near build --release

# Step 2: Create accounts and deploy
echo "🏗️  Creating accounts..."

# Create factory account
near account create-account sponsor-by-faucet-service $FACTORY_ACCOUNT autogenerate-new-keypair save-to-keychain network-config $NETWORK create

# Create resolver account  
near account create-account sponsor-by-faucet-service $RESOLVER_ACCOUNT autogenerate-new-keypair save-to-keychain network-config $NETWORK create

# Step 3: Deploy contracts
echo "🚢 Deploying contracts..."

# Deploy factory
near contract deploy $FACTORY_ACCOUNT use-file ../escrow-factory/target/near/escrow_factory.wasm without-init-call network-config $NETWORK sign-with-keychain send

# Deploy resolver
near contract deploy $RESOLVER_ACCOUNT use-file ../resolver/target/near/near_resolver.wasm without-init-call network-config $NETWORK sign-with-keychain send

# Step 4: Initialize contracts
echo "🔧 Initializing contracts..."

# Initialize factory
near contract call-function as-transaction $FACTORY_ACCOUNT new json-args "{\"owner\": \"$RESOLVER_ACCOUNT\", \"rescue_delay\": $RESCUE_DELAY}" prepaid-gas '30 TeraGas' attached-deposit '0 NEAR' sign-as $OWNER_ACCOUNT network-config $NETWORK sign-with-keychain send

# Set destination escrow code on factory
ESCROW_DST_CODE=$(cat ../escrow-dst/target/near/escrow_dst.wasm | base64)
near contract call-function as-transaction $FACTORY_ACCOUNT set_escrow_dst_code json-args "{\"escrow_code\": \"$ESCROW_DST_CODE\"}" prepaid-gas '30 TeraGas' attached-deposit '0 NEAR' sign-as $RESOLVER_ACCOUNT network-config $NETWORK sign-with-keychain send

# Set source escrow code on factory
ESCROW_SRC_CODE=$(cat ../escrow-src/target/near/escrow_src.wasm | base64)
near contract call-function as-transaction $FACTORY_ACCOUNT set_escrow_src_code json-args "{\"escrow_code\": \"$ESCROW_SRC_CODE\"}" prepaid-gas '30 TeraGas' attached-deposit '0 NEAR' sign-as $RESOLVER_ACCOUNT network-config $NETWORK sign-with-keychain send

# Initialize resolver with ETH resolver address
ETH_RESOLVER_ADDRESS="0x0000000000000000000000000000000000000000" # Replace with actual ETH resolver
near contract call-function as-transaction $RESOLVER_ACCOUNT new json-args "{\"owner\": \"$OWNER_ACCOUNT\", \"escrow_factory\": \"$FACTORY_ACCOUNT\", \"dst_chain_resolver\": \"$ETH_RESOLVER_ADDRESS\"}" prepaid-gas '30 TeraGas' attached-deposit '0 NEAR' sign-as $OWNER_ACCOUNT network-config $NETWORK sign-with-keychain send

echo "✅ Deployment complete!"
echo "Factory: $FACTORY_ACCOUNT"
echo "Resolver: $RESOLVER_ACCOUNT"

# Step 5: Verify deployment
echo "🔍 Verifying deployment..."

# Check factory stats
near contract call-function as-read-only $FACTORY_ACCOUNT get_stats text-args '' network-config $NETWORK now

# Check resolver config
near contract call-function as-read-only $RESOLVER_ACCOUNT get_owner text-args '' network-config $NETWORK now 