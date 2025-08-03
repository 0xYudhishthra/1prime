# 1Prime Protocol

![1Prime Logo](packages/1prime-website/public/logo.png)

**Secure Cross-Chain Atomic Swaps between EVM Chains and NEAR Protocol**

1Prime Protocol enables trustless, atomic swaps between EVM-compatible blockchains (Ethereum, Base, BSC, Polygon, Arbitrum) and NEAR Protocol using a sophisticated relayer-resolver architecture built on 1inch Fusion+ technology.

## Key Features

- **Cross-Chain Compatibility**: Seamless swaps between EVM chains ↔ NEAR Protocol
- **Atomic Security**: All-or-nothing execution prevents partial completion risks
- **On-Chain Verification**: Independent escrow verification before secret revelation
- **Real-Time Updates**: WebSocket-powered live order tracking
- **1inch Fusion+ Integration**: Built on proven 1inch technology with NEAR extensions
- **User-Friendly**: Simple frontend interface with Apple Shortcuts integration

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Relayer      │    │   Resolver      │
│  (Web + iOS)    │◄──►│   (Orchestrator)│◄──►│  (Executioner)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Cross-Chain SDK │    │   EVM Contracts │    │ NEAR Contracts  │
│   (TypeScript)  │    │   (Solidity)    │    │     (Rust)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Package Structure

| Package                                          | Purpose                                   | Technology                      |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------- |
| [`1prime-website`](./packages/1prime-website/)   | Frontend web application                  | Next.js, React, TailwindCSS     |
| [`cross-chain-sdk`](./packages/cross-chain-sdk/) | TypeScript SDK for cross-chain operations | TypeScript, 1inch Fusion+ SDK   |
| [`relayer`](./packages/relayer/)                 | Central orchestration service             | Node.js, TypeScript, PostgreSQL |
| [`resolver`](./packages/resolver/)               | Order execution service                   | Node.js, TypeScript, Web3       |
| [`evm-contracts`](./packages/evm-contracts/)     | Smart contracts for EVM chains            | Solidity, Hardhat               |
| [`near-contracts`](./packages/near-contracts/)   | Smart contracts for NEAR Protocol         | Rust, near-sdk                  |
| [`shortcut-auth`](./packages/shortcut-auth/)     | Apple Shortcuts authentication            | Swift, iOS Shortcuts            |

## Cross-Chain Atomic Swap Flow

The following diagram illustrates the complete flow of a cross-chain atomic swap:

![Cross-Chain Swap Flow](https://github.com/user-attachments/assets/e8def788-fec6-48c7-b5c8-b85f984c22aa)

### Detailed Flow Explanation

#### Phase 1: Order Creation & Preparation

1. **Secret Generation**: Frontend generates a cryptographically secure random number
2. **Hash Creation**: Secret is hashed using Keccak-256 to create `secretHash`
3. **Order Preparation**: Frontend calls `POST /orders/prepare` with:
   - `userSrcAddress` & `userDstAddress` (source and destination addresses)
   - `amount`, `fromToken`, `toToken` (swap parameters)
   - `fromChain`, `toChain` (blockchain identifiers)
   - `secretHash` (hashed secret for atomic locks)

#### Phase 2: Order Signing & Submission

4. **Fusion+ Order Creation**: Relayer creates a 1inch Fusion+ order using patched SDK
5. **Order Return**: Unsigned order with `orderHash` returned to frontend
6. **User Signature**: User signs the Fusion+ order with their wallet
7. **Order Submission**: Signed order submitted via `POST /orders/submit`

#### Phase 3: Resolver Discovery & Claiming

8. **Resolver Polling**: Resolvers continuously poll `GET /orders` for new orders
9. **Order Claiming**: Resolver claims order via `POST /orders/{hash}/claim`
   - Order transitions to `claimed` phase
   - Resolver becomes `assignedResolver`

#### Phase 4: Escrow Deployment & Verification

10. **Escrow Deployment**: Resolver deploys escrow contracts on both chains
11. **Deployment Confirmation**: `POST /orders/{hash}/escrow-deployed` with:
    - Contract addresses, transaction hashes, block numbers
    - **On-chain verification** automatically performed:
      - ✅ Contract existence verification
      - ✅ Transaction hash validation
      - ✅ USDC balance confirmation
      - ✅ Block number matching
12. **Safety Verification**: Frontend calls `GET /orders/{hash}/verify-escrows`
    - Independent verification that escrows are safe for secret revelation
    - Prevents fund loss from malicious or incorrectly configured escrows

#### Phase 5: Secret Revelation & Completion

13. **Secret Submission**: Once verified safe, frontend calls `POST /orders/{hash}/reveal-secret`
    - Submits the original random number (not the hash)
    - Secret stored in database for resolver access
14. **Secret Broadcasting**: Relayer broadcasts secret to all resolvers via WebSocket
15. **Atomic Completion**: Resolver uses secret to unlock funds on both chains simultaneously

## Security Features

### On-Chain Verification

- **Contract Validation**: Verifies escrow contracts exist and are properly deployed
- **Transaction Verification**: Confirms deployment transactions using block explorers
- **Balance Verification**: Ensures escrows contain required USDC amounts
- **Cross-Chain APIs**: Uses native blockchain APIs (Etherscan, NearBlocks) for verification

### Atomic Security

- **Hash Locks**: Secret hash locks prevent premature fund access
- **Time Locks**: Cancellation timeouts protect against stuck transactions
- **All-or-Nothing**: Either both sides complete or both sides can recover funds

### Access Control

- **Resolver Assignment**: Only assigned resolver can deploy escrows for an order
- **Verification Gates**: Multiple verification steps before secret revelation
- **WebSocket Security**: Real-time updates without exposing sensitive data

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+
- Rust (for NEAR contracts)
- Solidity compiler (for EVM contracts)

### Installation

```bash
# Clone the repository
git clone https://github.com/unite-defi/1prime-protocol.git
cd 1prime-protocol

# Quick setup (installs dependencies and copies environment files)
pnpm setup

# Build all packages
pnpm build:all
```

### Development Setup

```bash
# Start the relayer service
pnpm dev:relayer

# For production deployment
pnpm start:relayer
```

### Environment Configuration

The `pnpm setup` command automatically copies environment template files. Update them with your values:

#### Relayer Configuration (`packages/relayer/.env`)

```env
DATABASE_URL=postgresql://user:password@localhost:5432/relayer
ETHERSCAN_API_KEY=your_etherscan_key
NEARBLOCKS_API_KEY=your_nearblocks_key
ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/your-key
NEAR_RPC_URL=https://rpc.mainnet.near.org
```

#### Frontend Configuration (`packages/1prime-website/.env.local`)

```env
NEXT_PUBLIC_RELAYER_URL=http://localhost:3000
NEXT_PUBLIC_CHAIN_ENV=testnet
```

## Documentation

### Package Documentation

- [**Frontend Documentation**](./packages/1prime-website/README.md) - Web interface and user experience
- [**Cross-Chain SDK**](./packages/cross-chain-sdk/README.md) - TypeScript SDK for developers
- [**Relayer Service**](./packages/relayer/README.md) - Central orchestration service
- [**Resolver Service**](./packages/resolver/README.md) - Order execution and settlement
- [**EVM Contracts**](./packages/evm-contracts/README.md) - Ethereum-compatible smart contracts
- [**NEAR Contracts**](./packages/near-contracts/README.md) - NEAR Protocol smart contracts
- [**Apple Shortcuts**](./packages/shortcut-auth/README.md) - iOS integration

### API Documentation

- [**Relayer REST API**](./packages/relayer/openapi.yaml) - Complete OpenAPI specification
- [**WebSocket Events**](./packages/relayer/docs/websocket.md) - Real-time update documentation

## Supported Networks

### EVM Chains

- **Ethereum Mainnet** (Chain ID: 1)
- **Ethereum Sepolia** (Chain ID: 11155111) - Testnet
- **Base** (Chain ID: 8453)
- **BNB Smart Chain** (Chain ID: 56)
- **Polygon** (Chain ID: 137)
- **Arbitrum One** (Chain ID: 42161)

### NEAR Protocol

- **NEAR Mainnet** (Chain ID: mainnet)
- **NEAR Testnet** (Chain ID: 398) - Testnet

### Supported Token Pairs

- **USDC** ↔ **NEAR/USDC** (Primary focus)
- **ETH** ↔ **NEAR** (Native tokens)
- **WETH** ↔ **NEAR** (Wrapped tokens)

## Scripts

```bash
# Quick Setup
pnpm setup               # Install dependencies and copy environment files
pnpm setup:env           # Copy relayer .env.example to .env
pnpm setup:db            # Database setup instructions

# Development
pnpm dev:relayer         # Start relayer in development mode
pnpm start:relayer       # Start relayer in production mode

# Building
pnpm build:all           # Build all packages
pnpm build:relayer       # Build relayer service only
pnpm build:cross-chain-sdk # Build SDK only

# Testing
pnpm test:all            # Run all tests
pnpm test:relayer        # Test relayer service only

# Linting & Formatting
pnpm lint:all            # Lint all packages
pnpm format:all          # Format all code

# Cleanup
pnpm clean               # Remove all node_modules and build artifacts
```

## Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Run the test suite**: `pnpm test:all`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Guidelines

- Follow TypeScript best practices
- Add comprehensive tests for new features
- Update documentation for API changes
- Ensure all linting passes before submitting

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## Links

- **Website**: [https://1prime.io](https://1prime.io)
- **Documentation**: [https://docs.1prime.io](https://docs.1prime.io)
- **Discord**: [https://discord.gg/1prime](https://discord.gg/1prime)
- **Twitter**: [@1PrimeProtocol](https://twitter.com/1PrimeProtocol)
- **GitHub**: [https://github.com/unite-defi/1prime-protocol](https://github.com/unite-defi)

## Security Notice

This protocol handles cross-chain value transfers. Please:

- **Audit smart contracts** before mainnet deployment
- **Test thoroughly** on testnets before using mainnet
- **Report security issues** responsibly to security@1prime.io
- **Never reveal secrets** to unverified escrows

---

**Built with love by the 1Prime Team**

_Bridging the future of cross-chain DeFi, one atomic swap at a time._
