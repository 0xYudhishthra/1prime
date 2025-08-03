# NEAR Contracts for 1Prime Cross-Chain Swaps

NEAR Protocol smart contracts implementation for **1Prime**, enabling cross-chain atomic swaps between EVM chains and NEAR using **1inch Fusion+** intent-based swaps. This implementation preserves hashlock and timelock functionality for non-EVM environments while maintaining full compatibility with 1inch Fusion+ protocol specifications.

## Project Overview

1Prime is a cross-chain swap application that enables users to swap tokens between EVM chains and NEAR Protocol. This repository contains the NEAR smart contracts that power the NEAR side of these atomic swaps, working in coordination with 1inch Fusion+ orders on EVM chains.

### Key Features

- **Bidirectional Swaps**: Support for both EVM-to-NEAR and NEAR-to-EVM token transfers
- **1inch Fusion+ Integration**: Full compatibility with 1inch meta-order format and resolver system
- **Hashlock/Timelock Preservation**: Maintains atomic swap security guarantees in non-EVM environment
- **Partial Fill Support**: Enables incremental order execution via Merkle proofs
- **Testnet Deployment**: Ready-to-use contracts deployed on NEAR testnet

## Quick Start Guide

### Prerequisites

Install required tools:

```bash
# Install NEAR CLI
npm install -g near-cli

# Install Rust and cargo-near
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### Setup and Deploy

```bash
# 1. Create NEAR testnet accounts
near create-account your-factory.testnet --useFaucet
near create-account your-resolver.testnet --useFaucet
near create-account your-owner.testnet --useFaucet

# 2. Build contracts
cargo near build

# 3. Deploy factory contract
near deploy your-factory.testnet target/near/escrow_factory/escrow_factory.wasm

# 4. Deploy resolver contract
near deploy your-resolver.testnet target/near/near_resolver/near_resolver.wasm

# 5. Initialize contracts
near call your-factory.testnet new '{"owner": "your-resolver.testnet", "rescue_delay": 86400, "escrow_src_template": "template.testnet", "escrow_dst_template": "template.testnet"}' --accountId your-owner.testnet

near call your-resolver.testnet new '{"owner": "your-owner.testnet", "escrow_factory": "your-factory.testnet", "dst_chain_resolver": "0x0000000000000000000000000000000000000000"}' --accountId your-owner.testnet
```

### Pre-deployed Testnet Contracts

For immediate testing with 1Prime:

- Factory: `1prime-global-factory-contract.testnet`
- Resolver: `1prime-global-resolver-contract.testnet`
- Owner: `1prime-global-owner.testnet`

## Architecture Overview

### 1Prime Integration Flow

The NEAR contracts integrate with the 1Prime application flow:

1. **Order Creation**: 1Prime frontend generates hashlock and prepares Fusion+ order
2. **Relayer Coordination**: 1Prime relayer creates Fusion+ order with patched SDK
3. **NEAR Escrow Deployment**: These contracts deploy escrows on NEAR side
4. **Cross-Chain Execution**: Resolvers coordinate between EVM and NEAR chains
5. **Secret Revelation**: 1Prime frontend reveals secret to unlock funds

### Contract Architecture

**escrow-factory/** - Factory Contract
- Deploys escrow contracts deterministically
- Manages template contracts for gas efficiency
- Coordinates with 1Prime relayer system

**escrow-src/** - Source Chain Escrow (NEAR-to-EVM)
- Locks NEAR/NEP-141 tokens for outbound swaps
- Implements 1inch Fusion+ timelock phases A1-A4
- Handles partial fills via Merkle proof verification

**escrow-dst/** - Destination Chain Escrow (EVM-to-NEAR)
- Receives tokens from EVM chains via 1inch Fusion+
- Implements timelock phases B1-B4
- Manages secret revelation and fund release

**resolver/** - Cross-Chain Resolver
- Coordinates with 1Prime relayer infrastructure
- Processes orders from 1inch Fusion+ meta-order format
- Manages cross-chain state synchronization

## 1inch Fusion+ Compliance

### Timelock Implementation (1inch Whitepaper Section 2.4)

**Source Chain (NEAR-to-EVM) Phases:**
- A1: Finality lock period - prevents withdrawal during block finalization
- A2: Resolver exclusive period - only 1Prime resolver can execute
- A3: Public withdrawal - anyone can execute with revealed secret
- A4: Cancellation period - maker can cancel and recover funds

**Destination Chain (EVM-to-NEAR) Phases:**
- B1: Finality lock - ensures source chain finality
- B2: Resolver exclusive withdrawal - 1Prime resolver priority
- B3: Public withdrawal - open execution period
- B4: Cancellation - recovery for failed swaps

### Hashlock Mechanism (Section 2.3)

- SHA256 hashlock generation (compatible with 1Prime frontend)
- Secret revelation for fund release
- Cross-chain secret synchronization with EVM contracts
- Keccak-256 hash compatibility for EVM integration

### Meta-Order Format Compatibility

Supports 1inch Fusion+ meta-order structure:
- Order hash computation matches EVM implementation
- Maker/taker fields map to NEAR account IDs
- Token addresses translated to NEP-141 contract accounts
- Timelock calculations synchronized with EVM chains

## Contract Interfaces

### Factory Contract

```rust
pub struct EscrowFactory {
    // Deploy escrow for NEAR-to-EVM swaps
    pub fn create_src_escrow(immutables: Immutables) -> Promise<EscrowCreationResult>;

    // Deploy escrow for EVM-to-NEAR swaps
    pub fn create_dst_escrow(
        dst_immutables: Immutables,
        src_cancellation_timestamp: u64
    ) -> Promise<EscrowCreationResult>;

    // Get deployed escrow address
    pub fn get_escrow_address(order_hash: String) -> Option<AccountId>;
    pub fn compute_escrow_address(immutables: &Immutables) -> AccountId;
}
```

### Escrow Contracts

```rust
// Source escrow (NEAR-to-EVM)
pub struct EscrowSrc {
    pub fn withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn public_withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn cancel() -> Promise;
    pub fn get_escrow_info() -> EscrowInfo;
    pub fn get_current_phase() -> String;
}

// Destination escrow (EVM-to-NEAR)
pub struct EscrowDst {
    pub fn withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn public_withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn cancel() -> Promise;
    pub fn get_escrow_info() -> EscrowInfo;
    pub fn supports_partial_fills() -> bool;
}
```

### Resolver Contract

```rust
pub struct Resolver {
    // Deploy escrows from 1inch Fusion+ orders
    pub fn deploy_src(order: Order) -> Promise<EscrowCreationResult>;
    pub fn deploy_dst(order: Order, dst_complement: DstImmutablesComplement) -> Promise<EscrowCreationResult>;

    // Integration with 1Prime relayer
    pub fn get_owner() -> AccountId;
    pub fn process_fusion_order(meta_order: FusionMetaOrder) -> Promise;
}
```

## Token Support

### Native NEAR
```rust
// Direct NEAR transfers for gas-efficient swaps
Promise::new(recipient).transfer(amount)
```

### NEP-141 Tokens
```rust
// Cross-contract NEP-141 transfers for token swaps
ext_nep141::ext(token_contract)
    .ft_transfer(recipient, amount, memo)
```

## Security Features

### 1inch Protocol Security

- **Timelock Enforcement**: Strict phase validation prevents premature actions
- **Secret Verification**: SHA256 and Keccak-256 hash validation
- **Partial Fill Protection**: Merkle proof verification prevents double-spending
- **Cross-Chain Timing**: Synchronized with EVM chain timestamps

### NEAR-Specific Security

- **Access Control**: Only authorized resolvers can execute during exclusive periods
- **State Management**: Immutable order parameters prevent tampering
- **Emergency Rescue**: 30-day delay for emergency fund recovery
- **Gas Optimization**: Efficient storage patterns to prevent resource exhaustion

## Cross-Chain Integration

### EVM Chain Compatibility

- **1inch Fusion+ Orders**: Full compatibility with meta-order format
- **Resolver Coordination**: Seamless integration with EVM resolvers
- **Token Bridge Support**: Compatible with major EVM-NEAR bridges
- **Event Synchronization**: Cross-chain event monitoring and state sync

### 1Prime Application Integration

- **API Compatibility**: Contracts expose endpoints for 1Prime relayer
- **Order Status Tracking**: Real-time status updates for frontend polling
- **Secret Management**: Secure secret revelation workflow
- **Error Handling**: Comprehensive error reporting for debugging

## Deployment and Testing

### Build Contracts

```bash
# Build all contracts
cargo near build

# Deploy to testnet
./deploy.sh testnet

# Initialize with 1Prime configuration
./scripts/init-1prime.sh
```

### Testing with 1Prime

```bash
# Test EVM-to-NEAR swap
near call 1prime-global-resolver-contract.testnet deploy_dst \
  '{"order": {...}, "dst_complement": {...}}' \
  --accountId test-account.testnet --deposit 1.0

# Check swap status
near view escrow-address.testnet get_escrow_info '{}'

# Complete swap with secret
near call escrow-address.testnet withdraw \
  '{"secret": "0x123..."}' \
  --accountId resolver.testnet
```

## Hackathon Demo Features

### Fusion+ Extension to NEAR ✅

- **Hashlock/Timelock Preservation**: ✅ Full implementation
- **Bidirectional Swaps**: ✅ EVM↔NEAR support
- **Onchain Execution**: ✅ Testnet deployment ready
- **Partial Fills**: ✅ Merkle proof support

### Technical Validation

- **Real Token Transfers**: Handles NEAR and NEP-141 tokens
- **Cross-Chain Coordination**: Works with EVM Fusion+ contracts
- **Order Lifecycle**: Complete swap execution from order to settlement
- **Security Guarantees**: Atomic swap properties preserved

## References

- [1inch Fusion+ Whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf)
- [1Prime Application Repository](../../../)
- [NEAR SDK Documentation](https://docs.near.org/sdk/rust/introduction)
- [NEAR Testnet Explorer](https://explorer.testnet.near.org)

This NEAR implementation enables 1Prime to extend 1inch Fusion+ atomic swaps to non-EVM environments while maintaining full protocol compliance and security guarantees.
