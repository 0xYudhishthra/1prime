# NEAR Cross-Chain Escrow Contracts

NEAR Protocol implementation of 1inch Fusion+ destination chain contracts for EVM ↔ NEAR cross-chain atomic swaps.

## 🏗️ **Architecture Overview**

This implementation follows the [1inch Fusion+ whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf) specifications, providing NEAR as a destination chain for cross-chain atomic swaps. It mirrors the EVM contract architecture with NEAR-specific optimizations.

### **Core Components**

1. **🏭 Factory Contract** (`escrow-factory`) - Deploys and manages destination escrow contracts
2. **🔒 Destination Escrow** (`escrow-dst`) - Handles fund locking and unlocking with timelock phases

## 📋 **1inch Fusion+ Compliance**

### **Timelock Phases (Section 2.4)**

Our NEAR implementation strictly follows the whitepaper's timelock phases:

| Phase | EVM Name              | NEAR Name               | Description                   | Whitepaper Section |
| ----- | --------------------- | ----------------------- | ----------------------------- | ------------------ |
| B1    | `DstWithdrawal`       | `B1_FINALITY_LOCK`      | Finality lock period          | 2.4.1              |
| B2    | `DstWithdrawal`       | `B2_RESOLVER_EXCLUSIVE` | Resolver exclusive withdrawal | 2.4.2              |
| B3    | `DstPublicWithdrawal` | `B3_PUBLIC_WITHDRAWAL`  | Public withdrawal period      | 2.4.2              |
| B4    | `DstCancellation`     | `B4_CANCELLATION`       | Cancellation period           | 2.4.3              |

### **Partial Fill Support (Section 2.5)**

- ✅ **Merkle Tree Secrets**: N+1 secret management for partial fills
- ✅ **Proof Verification**: On-chain Merkle proof validation
- ✅ **Index Tracking**: Prevents double-spending of secrets
- ✅ **Progressive Filling**: Support for multiple resolvers per order

### **Safety Deposits (Section 2.4)**

- ✅ **Incentive Mechanism**: Safety deposits incentivize proper execution
- ✅ **Executor Rewards**: Withdrawal/cancellation executor receives deposit
- ✅ **Emergency Recovery**: 30-day rescue delay for stuck funds

## 🔄 **Cross-Chain Flow Implementation**

### **Phase 1: Announcement (EVM Side)**

```
User creates order → Relayer broadcasts → Dutch auction begins
```

### **Phase 2: Deposit (Our NEAR Implementation)**

```rust
// Resolver calls factory to create destination escrow
factory.create_dst_escrow(
    dst_immutables,     // Order details with timelock config
    src_cancellation    // Sync with source chain timing
) -> Promise<EscrowCreationResult>
```

### **Phase 3: Withdrawal (Secret Revelation)**

```rust
// Exclusive period (B2) - only resolver
escrow.withdraw(secret, merkle_proof?) -> Promise

// Public period (B3) - anyone can execute
escrow.public_withdraw(secret, merkle_proof?) -> Promise
```

### **Phase 4: Recovery (Cancellation)**

```rust
// Resolver can cancel and recover funds
escrow.cancel() -> Promise
```

## 🛠️ **Contract Interfaces**

### **Factory Contract**

```rust
pub struct EscrowFactory {
    pub fn create_dst_escrow(
        dst_immutables: Immutables,
        src_cancellation_timestamp: u64
    ) -> Promise;

    pub fn get_escrow_address(order_hash: String) -> Option<AccountId>;
    pub fn compute_escrow_address(immutables: &Immutables) -> AccountId;
}
```

### **Destination Escrow Contract**

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

## 🔐 **Security Features**

### **1. Timelock Enforcement**

- Strict phase validation prevents premature actions
- Timestamps use `env::block_timestamp_ms()` for precision
- Cross-chain timing synchronization

### **2. Secret Verification**

- SHA256 hash validation for single fills
- Merkle proof verification for partial fills
- Double-spending prevention via used indices tracking

### **3. Access Control**

- Only resolver (taker) can execute during exclusive periods
- Factory-only initialization prevents unauthorized deployments
- Emergency rescue requires 30-day delay

### **4. State Management**

- Immutable order parameters prevent tampering
- State transitions prevent double-execution
- Event logging for external monitoring

## 📊 **Token Support**

### **Native NEAR**

```rust
// Direct NEAR transfers
Promise::new(recipient).transfer(amount)
```

### **NEP-141 Tokens**

```rust
// Cross-contract NEP-141 transfers
ext_nep141::ext(token_contract)
    .ft_transfer(recipient, amount, memo)
```

## 🧪 **Testing & Deployment**

### **Build Contracts**

```bash
./build.sh
```

### **Deploy Factory**

```bash
near deploy --wasmFile build/escrow_factory.wasm --accountId factory.testnet
```

### **Initialize Factory**

```bash
near call factory.testnet new '{
  "owner": "owner.testnet",
  "rescue_delay": 2592000
}' --accountId owner.testnet
```

### **Set Escrow Code**

```bash
near call factory.testnet set_escrow_code \
  --base64 $(base64 -i build/escrow_dst.wasm) \
  --accountId owner.testnet \
  --gas 300000000000000
```

## 🔗 **Integration with EVM Resolver**

### **Resolver Flow**

1. **EVM Side**: Resolver creates source escrow via Limit Order Protocol
2. **NEAR Side**: Resolver calls `factory.create_dst_escrow()`
3. **Verification**: Relayer verifies both escrows are funded
4. **Secret Sharing**: Relayer provides secret after finality
5. **Execution**: Resolver uses secret to unlock both escrows

### **Event Synchronization**

```
EVM: SrcEscrowCreated(immutables, complement)
NEAR: DstEscrowCreated(escrow, hashlock, taker)
```

## 📈 **Gas Optimization**

### **NEAR-Specific Optimizations**

- **Account Model**: Uses AccountId instead of addresses
- **Storage Efficiency**: Minimal state storage with Vector collections
- **Gas Constants**: Tuned for NEAR's gas model
- **Promise Chaining**: Efficient cross-contract calls

### **Cross-Contract Call Patterns**

```rust
// Efficient promise chaining
self.transfer_funds_to_maker()
    .then(self.transfer_safety_deposit())
```

## 🎯 **Key Advantages**

### **1. Whitepaper Compliance**

- Exact timelock phase implementation
- Full partial fill support with Merkle trees
- Safety deposit mechanics

### **2. NEAR Integration**

- Native NEAR and NEP-141 token support
- Account-based addressing
- Efficient storage patterns

### **3. Production Ready**

- Comprehensive error handling
- Emergency recovery mechanisms
- Extensive validation checks

### **4. Extensible Design**

- Factory pattern for easy upgrades
- Modular contract architecture
- Event-driven monitoring

## 📚 **References**

- [1inch Fusion+ Whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf)
- [EVM Implementation](../sample-contracts/)
- [NEAR SDK Documentation](https://docs.near.org/sdk/rust/introduction)
- [Cross-Chain Test Examples](../tests/main.spec.ts)

## 🚀 **Production Considerations**

### **Deployment Checklist**

- [ ] Deploy factory with correct owner
- [ ] Set rescue delay (recommend 30 days)
- [ ] Upload and set escrow WASM code
- [ ] Test with small amounts first
- [ ] Monitor timelock phase transitions
- [ ] Set up event monitoring for failed transactions

### **Monitoring**

- Track escrow deployments via `DstEscrowCreated` events
- Monitor timelock phase transitions
- Alert on failed withdrawals or cancellations
- Track safety deposit claims

This implementation provides a complete, production-ready NEAR destination chain solution for 1inch Fusion+ cross-chain atomic swaps, maintaining full compatibility with the EVM source chain architecture while leveraging NEAR's unique advantages.
