# NEAR Cross-Chain Escrow Implementation

A NEAR Protocol implementation of 1inch Fusion+ cross-chain atomic swaps that enables bidirectional token transfers between Ethereum and NEAR ecosystems. This implementation preserves hashlock and timelock functionality for non-EVM environments while maintaining compatibility with the 1inch protocol specifications.

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

For immediate testing:

- Factory: `1prime-global-factory-contract.testnet`
- Resolver: `1prime-global-resolver-contract.testnet`
- Owner: `1prime-global-owner.testnet`

## Core File Structure and Functions

### Contract Implementation

**escrow-factory/** - Factory Contract

- `src/lib.rs` - Main factory implementation that deploys escrow contracts
- Core functions: `create_src_escrow()`, `create_dst_escrow()`, `get_escrow_address()`
- Manages template contracts and deployment lifecycle
- Implements deterministic address computation for escrow instances

**escrow-src/** - Source Chain Escrow

- `src/lib.rs` - Source escrow implementation for NEAR-to-ETH swaps
- Handles fund locking with maker deposits and safety deposits
- Implements withdrawal phases A1-A4 as defined in 1inch whitepaper section 2.4
- Supports partial fill mechanisms via Merkle proof verification

**escrow-dst/** - Destination Chain Escrow

- `src/lib.rs` - Destination escrow implementation for ETH-to-NEAR swaps
- Implements timelock phases B1-B4 following 1inch Fusion+ specification
- Manages secret revelation and fund release mechanisms
- Includes emergency rescue functionality with configurable delays

**resolver/** - Cross-Chain Resolver

- `src/lib.rs` - Resolver contract that coordinates cross-chain operations
- Implements order processing and escrow deployment coordination
- Manages communication with destination chain resolvers
- Handles cross-chain state synchronization

### Build and Deployment

**Cargo.toml** - Workspace configuration

- Defines all contract members and shared dependencies
- Configures NEAR SDK with global contracts feature
- Optimizes release builds for WASM deployment

**build.sh** - Contract compilation script

- Installs required targets and tools (wasm32-unknown-unknown, cargo-near)
- Builds all contracts with WASM embedding for templates
- Generates deployment-ready WASM files in target/near/ directories

**deploy.sh** - Automated deployment script

- Deploys all contracts to NEAR testnet/mainnet
- Configures template contracts and initializes factory
- Sets up resolver with cross-chain configuration
- Handles account creation and fund management

**env.example** - Configuration template

- Defines required environment variables for deployment
- Specifies account names and network configuration
- Includes ETH resolver address for cross-chain coordination

## Architecture Rationale Based on 1inch Whitepaper

### Timelock Implementation (Section 2.4)

The implementation strictly follows the 1inch Fusion+ timelock phases:

**Source Chain (NEAR-to-ETH) Phases:**

- A1: Finality lock period - prevents withdrawal during block finalization
- A2: Resolver exclusive period - only resolver can execute withdrawal
- A3: Public withdrawal - anyone can execute with revealed secret
- A4: Cancellation period - maker can cancel and recover funds

**Destination Chain (ETH-to-NEAR) Phases:**

- B1: Finality lock - ensures source chain finality
- B2: Resolver exclusive withdrawal - resolver priority period
- B3: Public withdrawal - open execution period
- B4: Cancellation - recovery mechanism for failed swaps

### Hashlock Mechanism (Section 2.3)

Implements cryptographic secret commitment scheme:

- SHA256 hashlock generation and verification
- Secret revelation for fund release
- Merkle tree integration for partial fills
- Cross-chain secret synchronization

### Partial Fill Support (Section 2.5)

Enables incremental order execution:

- N+1 secret management for multiple partial fills
- Merkle proof verification for secret validity
- Index tracking to prevent double-spending
- Progressive order completion across multiple transactions

### Safety Deposit System (Section 2.4)

Incentivizes proper execution:

- Maker deposits as execution guarantees
- Executor rewards for successful operations
- Penalty mechanisms for failed executions
- Emergency rescue with time delays

## Contract Usage

### Build and Deploy

```bash
# Build all contracts
cargo near build

# Deploy factory contract
near deploy your-factory.testnet target/near/escrow_factory/escrow_factory.wasm

# Deploy resolver contract
near deploy your-resolver.testnet target/near/near_resolver/near_resolver.wasm

# Initialize factory
near call your-factory.testnet new '{"owner": "your-resolver.testnet", "rescue_delay": 86400, "escrow_src_template": "template.testnet", "escrow_dst_template": "template.testnet"}' --accountId your-owner.testnet

# Initialize resolver
near call your-resolver.testnet new '{"owner": "your-owner.testnet", "escrow_factory": "your-factory.testnet", "dst_chain_resolver": "0x0000000000000000000000000000000000000000"}' --accountId your-owner.testnet
```

### Contract Interaction

```bash
# Create destination escrow
near call your-factory.testnet create_dst_escrow '{"dst_immutables": {"order_hash": "0x123...", "hashlock": "0xabc...", "maker": "maker.testnet", "taker": "your-resolver.testnet", "token": "near", "amount": "1000000000000000000000000", "safety_deposit": "100000000000000000000000", "timelocks": {...}}, "src_cancellation": 1234567890}' --accountId your-resolver.testnet --deposit 1.1

# View contract state
near view your-factory.testnet get_stats '{}'

# Check escrow status
near view escrow-account.testnet get_escrow_info '{}'
```

## Bounty Qualification Features

### Hashlock and Timelock Preservation

**Implementation Evidence:**

- `escrow-src/src/lib.rs` lines 200-250: Timelock validation in withdrawal methods
- `escrow-dst/src/lib.rs` lines 180-230: Hashlock verification in secret revelation
- Both contracts implement the exact timelock phases specified in 1inch whitepaper

**Key Functions:**

- `validate_timelock_phase()` - Ensures proper phase transitions
- `verify_hashlock()` - Validates secret against commitment
- `check_merkle_proof()` - Supports partial fill mechanisms

### Bidirectional Swap Functionality

**NEAR-to-ETH Direction:**

- `resolver/src/lib.rs` `deploy_src()` method creates source escrows on NEAR
- Source escrows lock NEAR tokens with proper timelock phases
- Secret revelation triggers fund release to destination

**ETH-to-NEAR Direction:**

- `resolver/src/lib.rs` `deploy_dst()` method creates destination escrows on NEAR
- Destination escrows receive funds locked on Ethereum
- Timelock phases enable safe fund release or cancellation

### Onchain Execution Capability

**Testnet Deployment:**

- Pre-deployed contracts on NEAR testnet for immediate testing
- Factory: `1prime-global-factory-contract.testnet`
- Resolver: `1prime-global-resolver-contract.testnet`
- Manual testing demonstrates end-to-end functionality

**Transaction Examples:**

- All operations generate verifiable blockchain transactions
- Real token transfers can be performed on testnet
- Escrow contracts handle actual NEAR and NEP-141 tokens

### Stretch Goal Implementation

**Partial Fill Support:**

- Merkle tree integration in both escrow contracts
- `MerkleProof` struct supports incremental order execution
- Secret indexing prevents double-spending attacks
- Multiple resolvers can participate in single order

**Technical Foundation for UI:**

- JSON-RPC compatible view methods for state inspection
- Event logging for transaction monitoring
- Standardized error handling and status reporting
- Complete API documentation in contract interfaces

## Contract Interfaces

### Factory Contract

```rust
pub struct EscrowFactory {
    pub fn create_src_escrow(
        immutables: Immutables
    ) -> Promise<EscrowCreationResult>;

    pub fn create_dst_escrow(
        dst_immutables: Immutables,
        src_cancellation_timestamp: u64
    ) -> Promise<EscrowCreationResult>;

    pub fn get_escrow_address(order_hash: String) -> Option<AccountId>;
    pub fn compute_escrow_address(immutables: &Immutables) -> AccountId;
}
```

### Source Escrow Contract

```rust
pub struct EscrowSrc {
    // Withdrawal methods
    pub fn withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn public_withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;

    // Cancellation
    pub fn cancel() -> Promise;

    // View methods
    pub fn get_escrow_info() -> EscrowInfo;
    pub fn get_current_phase() -> String;
}
```

### Destination Escrow Contract

```rust
pub struct EscrowDst {
    // Withdrawal methods
    pub fn withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;
    pub fn public_withdraw(secret: String, merkle_proof: Option<MerkleProof>) -> Promise;

    // Cancellation
    pub fn cancel() -> Promise;

    // View methods
    pub fn get_escrow_info() -> EscrowInfo;
    pub fn get_current_phase() -> String;
    pub fn supports_partial_fills() -> bool;
}
```

### Resolver Contract

```rust
pub struct Resolver {
    // Order deployment
    pub fn deploy_src(order: Order) -> Promise<EscrowCreationResult>;
    pub fn deploy_dst(order: Order, dst_complement: DstImmutablesComplement) -> Promise<EscrowCreationResult>;

    // View methods
    pub fn get_owner() -> AccountId;
}
```

## Cross-Chain Integration Points

### Ethereum Integration

**Resolver Coordination:**

- `dst_chain_resolver` field stores Ethereum resolver address
- Cross-chain message passing for state synchronization
- Compatible with existing 1inch Limit Order Protocol contracts

**Token Bridge Support:**

- NEP-141 token standard integration for fungible tokens
- Native NEAR token handling for gas-efficient transfers
- Configurable token contracts for multi-asset support

### Protocol Compliance

**1inch Compatibility:**

- Order structure matches EVM implementation
- Timelock calculations use identical formulas
- Hash computation follows protocol specifications
- Event emissions enable cross-chain monitoring

## Security Features

### Timelock Enforcement

- Strict phase validation prevents premature actions
- Timestamps use `env::block_timestamp_ms()` for precision
- Cross-chain timing synchronization

### Secret Verification

- SHA256 hash validation for single fills
- Merkle proof verification for partial fills
- Double-spending prevention via used indices tracking

### Access Control

- Only resolver (taker) can execute during exclusive periods
- Factory-only initialization prevents unauthorized deployments
- Emergency rescue requires 30-day delay

### State Management

- Immutable order parameters prevent tampering
- State transitions prevent double-execution
- Event logging for external monitoring

## Token Support

### Native NEAR

```rust
// Direct NEAR transfers
Promise::new(recipient).transfer(amount)
```

### NEP-141 Tokens

```rust
// Cross-contract NEP-141 transfers
ext_nep141::ext(token_contract)
    .ft_transfer(recipient, amount, memo)
```

## Gas Optimization

### NEAR-Specific Optimizations

- **Account Model**: Uses AccountId instead of addresses
- **Storage Efficiency**: Minimal state storage with Vector collections
- **Gas Constants**: Tuned for NEAR's gas model
- **Promise Chaining**: Efficient cross-contract calls

### Cross-Contract Call Patterns

```rust
// Efficient promise chaining
self.transfer_funds_to_maker()
    .then(self.transfer_safety_deposit())
```

## References

- [1inch Fusion+ Whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf)
- [NEAR SDK Documentation](https://docs.near.org/sdk/rust/introduction)
- [NEAR Explorer](https://explorer.testnet.near.org) - Monitor transactions
- [NEAR CLI Documentation](https://docs.near.org/tools/near-cli)

This implementation provides a complete non-EVM extension for 1inch Fusion+ that maintains protocol compliance while enabling efficient cross-chain atomic swaps between Ethereum and NEAR ecosystems.
