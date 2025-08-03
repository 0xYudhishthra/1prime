# 1Prime Shortcut Auth API

A Cloudflare Workers-based API that powers **1Prime** - enabling cross-chain swaps between EVM chains and NEAR protocol through Apple Shortcuts and Siri voice commands.

## 🌟 Overview

**1Prime** is a hackathon project that brings **1inch Fusion+ atomic swaps** to cross-chain operations between EVM chains (Ethereum, Arbitrum, Optimism) and NEAR protocol. This API serves as the backend for Apple Shortcuts integration, allowing users to perform complex cross-chain operations through simple voice commands.

### Key Features

- 🎙️ **Voice-First UX**: Control cross-chain swaps via Siri
- ⚛️ **Atomic Swaps**: Powered by 1inch Fusion+ protocol
- 🔗 **Bi-directional**: EVM ↔ NEAR protocol support
- 🔐 **Smart Wallets**: Auto-generated ZeroDev smart wallets + NEAR accounts
- 💰 **Multi-Token**: Comprehensive ERC-20 and NEP-141 token support
- 📱 **Apple Shortcuts**: Native iOS integration for voice control

## 🔧 API Endpoints

### Authentication
- `POST /sign-up/email` - Create account with auto-generated wallets
- `POST /sign-in/email` - Authenticate user
- `GET /api/**` - Better-auth session management

### Cross-Chain Swaps (🆕 Main Feature)
- `POST /api/cross-chain-swap` - Initiate cross-chain swap
- `GET /api/cross-chain-swap/{orderId}/status` - Get swap status
- `GET /api/cross-chain-swap/orders` - Get user's swap history
- `POST /hash-random-number` - Utility for Keccak-256 hashing

### Wallet Management
- `GET /api/wallet/addresses` - Get EVM and NEAR addresses
- `GET /api/wallet/balances` - Multi-chain token balances
- `GET /api/wallet/supported-chains` - Supported EVM chains
- `POST /api/wallet/near/check-token` - Check specific NEAR token

### Transactions
- `POST /api/send-transaction` - Send EVM transaction
- `POST /api/send-near-transaction` - Send NEAR transaction

## 🚀 Cross-Chain Swap Flow

1. **Voice Command**: User says *"Hey Siri, swap my tokens"*
2. **Apple Shortcut**: Captures user intent (amount, chains)
3. **API Call**: `POST /api/cross-chain-swap` with user-friendly parameters
4. **Processing**: 
   - Maps chain names to IDs (`"ethereum"` → `"11155111"`)
   - Converts amounts (`"10"` → `"10000000"` for USDC)
   - Auto-assigns USDC token contracts
   - Approves USDC spending on NEAR (if needed)
5. **1inch Fusion+**: Creates atomic swap order with relayer
6. **Real-time Tracking**: Polls order status every 2 seconds
7. **Secret Revelation**: Completes atomic swap when escrows verified
8. **Voice Feedback**: Siri announces completion

### Supported Chains & Tokens

| Chain | Network | Chain ID | USDC Contract |
|-------|---------|----------|---------------|
| Ethereum | Sepolia | `11155111` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Arbitrum | Sepolia | `421614` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Optimism | Sepolia | `11155420` | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |
| NEAR | Testnet | `398` | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |
| NEAR | Mainnet | `mainnet` | `a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near` |

## 🛠️ Development Setup

### Prerequisites
- Node.js 20+
- pnpm 8+
- Cloudflare Workers account
- PostgreSQL database (for production)

### Environment Variables

Create both `.env` and `.dev.vars` with the same variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# ZeroDev RPC URLs
ZERODEV_ETHEREUM_SEPOLIA_RPC=https://rpc.zerodev.app/api/v2/bundler/...
ZERODEV_ARBITRUM_SEPOLIA_RPC=https://rpc.zerodev.app/api/v2/bundler/...
ZERODEV_OPTIMISM_SEPOLIA_RPC=https://rpc.zerodev.app/api/v2/bundler/...

# Better Auth
BETTER_AUTH_SECRET=your-secret-key
BETTER_AUTH_URL=https://your-domain.workers.dev

# Relayer
RELAYER_URL=https://1prime-relayer.up.railway.app/api/v1  # Production
# RELAYER_URL=http://localhost:3000/api/v1  # Development
```

### Installation & Development

```bash
# Install dependencies
pnpm install

# Generate Cloudflare types
pnpm run cf-typegen

# Run development server
pnpm run dev

# Deploy to Cloudflare Workers
pnpm run deploy
```

### Database Setup

```bash
# Generate and run migrations
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

## 📱 Apple Shortcuts Integration

### Available Shortcuts

1. **[Import Apple Shortcut](https://www.icloud.com/shortcuts/70defed281024a5b9ba729f9594e386c)** - Setup/onboarding
2. **[Swap Now](https://www.icloud.com/shortcuts/ddc64c83175f438cbf016bcdbabb5dcf)** - Direct swap functionality

### Voice Commands

- *"Hey Siri, Login to 1Prime"* - Authenticate and store token
- *"Hey Siri, swap my tokens"* - Initiate cross-chain swap
- *"Hey Siri, check my wallet"* - View balances

### Token Storage
Authentication tokens are stored in the iOS `Downloads/` folder for persistence across shortcuts. While not ideal for production security, this approach enables seamless voice-controlled session management for the hackathon demo.

## 🔗 Example API Usage

### Cross-Chain Swap Request

```bash
curl -X POST https://shortcut-auth.tanweihup.workers.dev/api/cross-chain-swap \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "10",
    "fromChain": "ethereum", 
    "toChain": "near"
  }'
```

### Response

```json
{
  "success": true,
  "data": {
    "orderId": "order_1754225913981_dfjl1cmae",
    "status": "completed",
    "message": "Cross-chain swap completed successfully"
  },
  "timestamp": 1703123456789
}
```

## 🏗️ Architecture

### Tech Stack
- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Better-auth
- **EVM Wallets**: ZeroDev smart accounts
- **NEAR Integration**: @near-js SDK
- **Atomic Swaps**: 1inch Fusion+ protocol

### Smart Wallet Features
- **Multi-chain Deployment**: Same address across all EVM chains
- **Gas Abstraction**: Simplified transaction signing
- **Account Abstraction**: Enhanced UX for cross-chain operations

## 📖 API Documentation

Complete API documentation is available in `openapi.yaml`. Key features:

- **OpenAPI 3.1.3** specification
- **Interactive documentation** with examples
- **Authentication flows** and error handling
- **Cross-chain swap** detailed workflows
- **Multi-chain wallet** operations

## 🎯 Hackathon Tracks

This project targets multiple 1inch hackathon tracks:

1. **Extend Fusion+ to NEAR** ✅
   - Bidirectional EVM ↔ NEAR swaps
   - Hashlock/timelock preservation
   - Testnet execution demonstrated

2. **Build Full Application using 1inch APIs** ✅
   - 1inch Fusion+ integration
   - Multi-chain wallet balances
   - Voice-controlled UX

3. **Apple Shortcuts Innovation** 🆕
   - First voice-controlled cross-chain swaps
   - iOS ecosystem integration
   - Unique accessibility features

## 🔐 Security Notes

⚠️ **This is a proof-of-concept for hackathon validation**

- Simplified authentication for demo purposes
- Token storage in Downloads/ folder (not production-ready)
- Testnet-only operations currently supported
- Smart contract audits pending for mainnet deployment

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details.

---

**1Prime** - Cross-Chain Swaps via Voice • [GitHub](https://github.com/0xYudhishthra/1prime)