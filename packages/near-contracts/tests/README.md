# NEAR Cross-Chain Escrow Testing Guide

This directory contains comprehensive testing tools for the NEAR cross-chain escrow contracts using NEAR testnet for real-world testing.

## 🏗️ Architecture

The testing setup includes:

- **NEAR Testnet Integration**: Real blockchain environment testing with pre-deployed contracts
- **Contract Interaction Tests**: Testing deployed factory and resolver contract functionality
- **Example Scripts**: Interactive demonstrations of cross-chain swap flows
- **Performance Monitoring**: Gas usage and execution time analysis

## 📋 Prerequisites

- **NEAR CLI**: Install with `npm install -g near-cli`
- **Node.js**: Version 16+ for running test scripts
- **NEAR Testnet Accounts**: Create at https://wallet.testnet.near.org
- **Testnet NEAR Tokens**: Get free tokens at https://near-faucet.io/

## 🚀 Quick Start

### 1. Environment Setup

Set up your testnet accounts (optional - defaults will be used if not set):

```bash
export FACTORY_ACCOUNT="your-factory.testnet"
export RESOLVER_ACCOUNT="your-resolver.testnet"
export MAKER_ACCOUNT="your-maker.testnet"
export TAKER_ACCOUNT="your-taker.testnet"
```

### 2. Build and Deploy Contracts

```bash
cd packages/near-contracts/tests
./run-testnet-tests.sh
```

This script will:

- Check pre-deployed contract status on testnet
- Test factory and resolver contract functionality
- Run escrow creation and interaction tests
- Run comprehensive integration tests

### 3. Run Example Scripts

```bash
cd examples

# Demonstrate NEAR → ETH swap flow
node near-to-eth-swap.js

# Demonstrate ETH → NEAR swap flow
node eth-to-near-swap.js
```

## 🧪 Test Categories

### Integration Tests (`integration-tests.js`)

Comprehensive testing covering:

- **Prerequisites Check**: Testnet connectivity, CLI tools, credentials
- **Contract Building**: WASM compilation verification
- **Account Management**: Testnet account validation
- **Contract Deployment**: Factory and resolver deployment
- **WASM Code Setup**: Escrow contract code configuration
- **Functionality Testing**: End-to-end escrow operations
- **View Methods**: Contract state inspection

### Example Scripts (`examples/`)

Interactive demonstrations:

- **near-to-eth-swap.js**: Source escrow creation on NEAR
- **eth-to-near-swap.js**: Destination escrow creation on NEAR

## 📊 Running Tests

### All Tests

```bash
npm test
# or
node integration-tests.js
```

### With Shell Script

```bash
npm run test:testnet
# or
./run-testnet-tests.sh
```

### Individual Examples

```bash
npm run near-to-eth
npm run eth-to-near
```

## 🔧 Configuration

### Pre-deployed Contract Addresses

The following contracts are already deployed on NEAR testnet:

- **Factory**: `1prime-global-factory-contract.testnet`
- **Resolver**: `1prime-global-resolver-contract.testnet`
- **Escrow Src Template**: `1prime-global-escrow-src-template.testnet`
- **Escrow Dst Template**: `1prime-global-escrow-dst-template.testnet`
- **Owner**: `1prime-global-owner.testnet`

### Test Account Configuration

Create your own test accounts (customize via environment variables):

- **Maker**: `maker-test.testnet` (or set `MAKER_ACCOUNT`)
- **Taker**: `taker-test.testnet` (or set `TAKER_ACCOUNT`)

## 📝 Test Output

Tests provide detailed colored output showing:

- ✅ **PASS**: Successful operations
- ❌ **FAIL**: Failed operations with error details
- ⚠️ **SKIP**: Skipped operations (missing dependencies)

Example output:

```
🧪 NEAR Cross-Chain Escrow Integration Tests
═══════════════════════════════════════════

🔍 Checking Prerequisites
✅ NEAR Testnet Status: Connected to testnet RPC
✅ NEAR CLI: Installed
✅ Contract Builds: All WASM files present
✅ Testnet Credentials: Found testnet keys

🔨 Building Contracts
✅ Contract Build: All contracts built successfully
```

## 🔍 Debugging

### View Contract State

```bash
# Check factory statistics
near view escrow-factory.testnet get_factory_stats \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet

# Get escrow address for order
near view escrow-factory.testnet get_escrow_address \
  '{"order_hash": "your_order_hash"}' \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet
```

### Monitor Transactions

- **Testnet Explorer**: https://explorer.testnet.near.org
- **Search by**: Account ID, transaction hash, or block height

## 🚨 Troubleshooting

### "Cannot connect to NEAR testnet"

- Check internet connection
- Verify testnet status at https://explorer.testnet.near.org

### "Account not found"

1. Create accounts at https://wallet.testnet.near.org
2. Fund with testnet NEAR at https://near-faucet.io/
3. Verify account names match configuration

### "Contract not deployed"

```bash
# Redeploy contracts
./run-testnet-tests.sh
```

### "Insufficient balance"

- Get more testnet NEAR at https://near-faucet.io/
- Check account balance: `near view-account your-account.testnet`

## 🔗 Resources

- **Testnet Explorer**: https://explorer.testnet.near.org
- **Testnet Wallet**: https://wallet.testnet.near.org
- **Testnet Faucet**: https://near-faucet.io/
- **NEAR CLI Docs**: https://docs.near.org/tools/near-cli
- **Contract Documentation**: `../README.md`

## 💡 Best Practices

1. **Account Management**: Use descriptive account names for easier debugging
2. **Gas Monitoring**: Watch gas usage patterns in test output
3. **State Inspection**: Always check contract state before/after operations
4. **Error Testing**: Intentionally trigger edge cases to test error handling
5. **Documentation**: Keep test scenarios documented for team collaboration

## 📈 Performance

The test suite monitors:

- **Gas Usage**: Per-operation gas consumption
- **Execution Time**: Contract deployment and call latency
- **Success Rates**: Operation success/failure statistics
- **State Size**: Contract storage utilization

This testnet-based approach provides realistic performance metrics for production deployment planning.
