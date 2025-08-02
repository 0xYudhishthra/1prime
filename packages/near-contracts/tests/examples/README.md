# NEAR Cross-Chain Escrow Examples

This directory contains interactive examples demonstrating cross-chain swap flows between NEAR and Ethereum using NEAR testnet for real-world testing and development.

## 🏗️ Overview

These examples provide hands-on demonstrations of the complete cross-chain escrow system, allowing you to test all functionality on NEAR testnet with real but low-value transactions.

## 📋 Prerequisites

1. **NEAR Testnet Accounts**: Create accounts at https://wallet.testnet.near.org
2. **Testnet NEAR Tokens**: Get free tokens at https://near-faucet.io/
3. **NEAR CLI**: Install with `npm install -g near-cli`
4. **Node.js**: For running the example scripts
5. **Contracts Deployed**: Run the test suite first to deploy contracts

## 🚀 Quick Start

```bash
# 1. Set up environment variables (optional)
export FACTORY_ACCOUNT="your-factory.testnet"
export RESOLVER_ACCOUNT="your-resolver.testnet"
export MAKER_ACCOUNT="your-maker.testnet"
export TAKER_ACCOUNT="your-taker.testnet"

# 2. Build and deploy contracts
cd packages/near-contracts/tests
node integration-tests.js

# 3. Run examples
cd examples
node near-to-eth-swap.js
node eth-to-near-swap.js
```

## 📁 Examples

### 1. NEAR → ETH Swap (`near-to-eth-swap.js`)

Demonstrates how to initiate a swap from NEAR to Ethereum:

- **User**: Wants to trade 2 NEAR for ETH/USDC
- **Process**: Creates source escrow on NEAR via resolver
- **Output**: Shows order hash, secret, and next steps

```bash
node near-to-eth-swap.js
```

### 2. ETH → NEAR Swap (`eth-to-near-swap.js`)

Demonstrates how to complete a swap from Ethereum to NEAR:

- **User**: Has deposited USDC on Ethereum (simulated)
- **Process**: Creates destination escrow on NEAR
- **Output**: Shows withdrawal commands and escrow status

```bash
node eth-to-near-swap.js
```

## 🔧 Configuration

Both examples use the same testnet configuration:

```javascript
const config = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  accounts: {
    factory: process.env.FACTORY_ACCOUNT || "escrow-factory.testnet",
    resolver: process.env.RESOLVER_ACCOUNT || "escrow-resolver.testnet",
    maker: process.env.MAKER_ACCOUNT || "maker-test.testnet",
    taker: process.env.TAKER_ACCOUNT || "taker-test.testnet",
  },
};
```

## 🧪 Testing Scenarios

### Complete Swap Flow

1. **Run NEAR → ETH example**:

   ```bash
   node near-to-eth-swap.js
   ```

   - Note the secret and escrow address

2. **Simulate ETH side deployment** (manual step)

3. **Complete withdrawal**:
   ```bash
   # Use the secret from step 1
   near call <escrow_address> withdraw '{"secret": "<secret>"}' \
     --accountId escrow-resolver.testnet \
     --gas 100000000000000 \
     --nodeUrl https://rpc.testnet.near.org \
     --networkId testnet
   ```

### Timelock Testing

1. **Create escrow** using either example
2. **Check phases** over time:
   ```bash
   near view <escrow_address> get_current_phase \
     --nodeUrl https://rpc.testnet.near.org \
     --networkId testnet
   ```
3. **Wait for timeout** and test cancellation:
   ```bash
   near call <escrow_address> cancel \
     --accountId taker-test.testnet \
     --gas 100000000000000 \
     --nodeUrl https://rpc.testnet.near.org \
     --networkId testnet
   ```

### Error Scenarios

- **Invalid secret**: Try withdrawing with wrong secret
- **Wrong account**: Try calling methods from unauthorized accounts
- **Timing issues**: Try operations outside their valid timelock phases

## 🔍 Debugging

### View Escrow State

```bash
# Get detailed escrow information
near view <escrow_address> get_escrow_info \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet

# Check current timelock phase
near view <escrow_address> get_current_phase \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet

# Check time remaining in current phase
near view <escrow_address> get_time_remaining \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet
```

### Monitor Events

Use the testnet explorer to monitor contract events:

- **URL**: https://explorer.testnet.near.org
- **Search**: Use order hash or escrow address

### Check Factory Status

```bash
# View factory statistics
near view escrow-factory.testnet get_factory_stats \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet

# Get escrow address for order
near view escrow-factory.testnet get_escrow_address '{"order_hash": "<order_hash>"}' \
  --nodeUrl https://rpc.testnet.near.org \
  --networkId testnet
```

## 📊 Output Examples

### Successful NEAR → ETH Swap

```
🌉 NEAR → ETH Cross-Chain Swap Example (Testnet)
═══════════════════════════════════════════════
✅ NEAR testnet is accessible

Step 1: Generate Swap Secrets
─────────────────────────────
🔑 Secret: a1b2c3d4e5f6...
🔐 Hashlock: 9f8e7d6c5b4a...

Step 2: Create Source Escrow on NEAR
────────────────────────────────────
🔄 Creating source escrow...
✅ Source escrow created successfully!
   Transaction: 8H7G6F5E4D3C...

Summary
───────
🎉 NEAR → ETH swap simulation completed!
• Order Hash: 1a2b3c4d...
• Amount: 2 NEAR → ETH/USDC
• Secret: a1b2c3d4e5f6...
```

## 🚨 Troubleshooting

### "Cannot connect to NEAR testnet"

- Check your internet connection
- Verify testnet is operational at https://explorer.testnet.near.org

### "Account not found"

1. Create testnet accounts at https://wallet.testnet.near.org
2. Fund them with testnet NEAR at https://near-faucet.io/
3. Update environment variables or use default account names

### "Contract not deployed"

```bash
# Deploy contracts first
cd ../
node integration-tests.js
```

### "Transaction failed"

- Check gas limits (default: 300 TGas)
- Verify account has sufficient balance
- Ensure correct account permissions

## 🔗 Related Resources

- **Integration Tests**: `../integration-tests.js`
- **Contract Documentation**: `../../README.md`
- **Testing Setup Guide**: `../README.md`
- **Testnet Explorer**: https://explorer.testnet.near.org
- **Testnet Wallet**: https://wallet.testnet.near.org
- **Testnet Faucet**: https://near-faucet.io/

## 💡 Development Tips

1. **Interactive Testing**: Use the examples to generate valid transactions, then modify them manually
2. **State Inspection**: Always check escrow state before and after operations
3. **Timing Simulation**: Modify timelock values to test different phases quickly
4. **Error Handling**: Intentionally trigger errors to test edge cases
5. **Gas Optimization**: Monitor gas usage patterns for optimization opportunities

These testnet examples provide a real-world testing environment for all aspects of the cross-chain escrow system before deploying to mainnet.
