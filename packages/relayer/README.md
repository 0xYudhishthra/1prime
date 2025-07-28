# 1Prime Relayer Service

A 1inch Fusion+ compatible relayer service that facilitates cross-chain atomic swaps between EVM chains (Ethereum, Base, BSC, Polygon, Arbitrum) and NEAR Protocol.

This implementation follows the 1inch Fusion+ whitepaper architecture but simplified to use only HTLC (Hashed Timelock Contracts) for atomic swaps, removing the complexity of Turnstile and Fulfillment contracts while maintaining the core auction and secret revelation mechanisms.

## Overview

This relayer service implements the complete 1inch Fusion+ protocol as described in their [whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf), with extended support for EVM <> NEAR cross-chain swaps. It provides:

- **Dutch Auction Management**: Competitive bidding system for order resolvers
- **Escrow Verification**: Contract deployment and balance checking across chains
- **Secret Management**: Secure handling and conditional disclosure of HTLC secrets
- **Timelock Management**: Phase transition logic following 1inch Fusion+ specifications
- **Modular Chain Support**: Extensible architecture for adding new EVM chains

## Architecture

### Core Components

1. **Order Manager**: Handles order creation, Dutch auctions, and resolver bidding
2. **Escrow Verifier**: Monitors contract deployments and balance verification
3. **Secret Manager**: Manages secret storage, Merkle trees, and conditional revelation
4. **Timelock Manager**: Enforces phase transitions and timing constraints
5. **Chain Adapters**: Modular interfaces for EVM and NEAR blockchain interactions

### Supported Chain Pairs

- Ethereum ↔ NEAR
- Base ↔ NEAR
- BSC ↔ NEAR
- Polygon ↔ NEAR
- Arbitrum ↔ NEAR

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or pnpm
- Redis (optional, for production)

### Installation

```bash
cd packages/relayer
npm install
```

### Database Setup

The relayer uses Supabase for persistent storage of orders and resolver information:

1. **Create a Supabase Project**: Go to [supabase.com](https://supabase.com) and create a new project
2. **Run the Schema**: Copy the contents of `supabase-schema.sql` and run it in your Supabase SQL editor
3. **Get Credentials**: Copy your project URL and anon key from the Supabase dashboard

### Configuration

Create a `.env` file with the following variables:

<details>
<summary>📋 <strong>Quick .env Template (Click to expand)</strong></summary>

```bash
# 1Prime Relayer Service Environment Configuration
# Copy these values to your .env file and update accordingly

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Database Configuration (Supabase)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Redis Configuration (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# Security & Rate Limiting
ENABLE_RATE_LIMIT=true
MAX_REQUESTS_PER_MINUTE=100
CORS_ORIGINS=*

# Blockchain Configuration
SUPPORTED_CHAINS=ethereum,near
EVM_PRIVATE_KEY=your_evm_private_key_here
NEAR_PRIVATE_KEY=your_near_private_key_here

# RPC Endpoints
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
BASE_RPC_URL=https://mainnet.base.org
BSC_RPC_URL=https://bsc-dataseed1.binance.org/
POLYGON_RPC_URL=https://polygon-rpc.com/
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
NEAR_RPC_URL=https://rpc.mainnet.near.org
NEAR_TESTNET_RPC_URL=https://rpc.testnet.near.org

# Smart Contract Addresses
ETHEREUM_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
BASE_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
BSC_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
POLYGON_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
ARBITRUM_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
NEAR_HTLC_ADDRESS=htlc.1prime.near
NEAR_TESTNET_HTLC_ADDRESS=htlc.testnet

# Relayer Settings
MAX_ACTIVE_ORDERS=100
ENABLE_PARTIAL_FILLS=true
HEALTH_CHECK_INTERVAL=30000
ESCROW_CHECK_INTERVAL=10000
TIMELOCK_CHECK_INTERVAL=30000
```
</details>

#### Server Configuration

```bash
# Port for the relayer API server
PORT=3000

# Environment mode: development, staging, or production
NODE_ENV=development

# Logging level: debug, info, warn, error
LOG_LEVEL=info

# Optional: Log file path (if not set, logs only to console)
# LOG_FILE=logs/relayer.log
```

#### Database Configuration (Supabase)

```bash
# Your Supabase project URL
SUPABASE_URL=https://your-project-id.supabase.co

# Your Supabase anon/public key
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

#### Redis Configuration (Optional)

```bash
# Redis host for caching and session management
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=your_redis_password
REDIS_DB=0
```

#### Security & Rate Limiting

```bash
# Enable rate limiting for API endpoints
ENABLE_RATE_LIMIT=true

# Maximum requests per minute per IP
MAX_REQUESTS_PER_MINUTE=100

# CORS origins (comma-separated, use * for all origins)
CORS_ORIGINS=*
```

#### Blockchain Configuration

```bash
# Supported blockchain pairs (comma-separated)
SUPPORTED_CHAINS=ethereum,near

# Private Keys for Transaction Signing
# ⚠️ IMPORTANT: Keep these secure and never commit to version control

# Single EVM private key used for all EVM chains
EVM_PRIVATE_KEY=your_evm_private_key_here

# NEAR Protocol private key
NEAR_PRIVATE_KEY=your_near_private_key_here
```

#### RPC Endpoints

```bash
# Chain RPC URLs
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
BASE_RPC_URL=https://mainnet.base.org
BSC_RPC_URL=https://bsc-dataseed1.binance.org/
POLYGON_RPC_URL=https://polygon-rpc.com/
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
NEAR_RPC_URL=https://rpc.mainnet.near.org
NEAR_TESTNET_RPC_URL=https://rpc.testnet.near.org
```

#### Smart Contract Addresses

```bash
# HTLC Contract Addresses (update with deployed contract addresses)
ETHEREUM_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
BASE_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
BSC_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
POLYGON_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
ARBITRUM_HTLC_ADDRESS=0x0000000000000000000000000000000000000000
NEAR_HTLC_ADDRESS=htlc.1prime.near
NEAR_TESTNET_HTLC_ADDRESS=htlc.testnet
```

#### Relayer Settings

```bash
# Maximum number of active orders the relayer can handle
MAX_ACTIVE_ORDERS=100

# Enable partial order fulfillment
ENABLE_PARTIAL_FILLS=true

# Monitoring intervals (in milliseconds)
HEALTH_CHECK_INTERVAL=30000
ESCROW_CHECK_INTERVAL=10000
TIMELOCK_CHECK_INTERVAL=30000
```

### Running the Service

```bash
# Development
npm run dev

# Production
npm run build
npm start

# Testing
npm test
```

## API Reference

### Base URL

`http://localhost:3000/api/v1`

### Endpoints

#### Health Check

```http
GET /health
```

Returns the health status of the relayer service and all connected chains.

#### Create Order

```http
POST /orders
Content-Type: application/json
x-maker-address: 0x...

{
  "sourceChain": "ethereum",
  "destinationChain": "near",
  "sourceToken": "ETH",
  "destinationToken": "NEAR",
  "sourceAmount": "1.0",
  "destinationAmount": "100.0",
  "timeout": 1640995200000,
  "signature": "0x...",
  "nonce": "unique-nonce"
}
```

#### Get Order Status

```http
GET /orders/{orderHash}
```

#### Submit Resolver Bid

```http
POST /bids
Content-Type: application/json

{
  "orderHash": "0x...",
  "resolver": "0x...",
  "bondProof": "proof-string",
  "estimatedGas": 150000,
  "signature": "0x..."
}
```

#### Request Secret Reveal

```http
POST /secrets/reveal
Content-Type: application/json

{
  "orderHash": "0x...",
  "secret": "secret-value",
  "proof": "proof-string",
  "signature": "0x..."
}
```

#### Register Resolver

```http
POST /resolvers
Content-Type: application/json

{
  "address": "0x...",
  "isKyc": true,
  "bondAmount": "1000000",
  "tier": 2,
  "reputation": 95
}
```

## Protocol Flow

### Phase 1: Announcement

1. Maker creates order with secret hash
2. Dutch auction begins with initial rate bump
3. Resolvers compete based on tier and profitability

### Phase 2: Deposit

1. Winning resolver creates escrows on both chains
2. Relayer verifies escrow parameters and amounts
3. Finality lock period begins

### Phase 3: Withdrawal

1. After finality, relayer discloses secret to resolvers
2. Exclusive withdrawal period for winning resolver
3. General withdrawal period if resolver fails to act

### Phase 4: Recovery

1. Timeout handling and fund recovery
2. Cancellation logic for failed swaps
3. Safety deposit redistribution

## Testing

The relayer includes comprehensive tests covering:

- API endpoint validation and error handling
- Order lifecycle management
- Dutch auction mechanics
- Secret management and disclosure
- Timelock phase transitions
- Chain adapter functionality

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode during development
npm run test:watch
```

## Adding New EVM Chains

The relayer is designed for easy extension to new EVM chains:

1. Add chain configuration to `src/config/chains.ts`:

```typescript
mynewchain: {
  ...DEFAULT_EVM_CONFIG,
  chainId: '12345',
  name: 'My New Chain',
  rpcUrl: process.env.MYNEWCHAIN_RPC_URL,
  contractAddresses: {
    htlc: process.env.MYNEWCHAIN_HTLC_ADDRESS,
    fulfillment: process.env.MYNEWCHAIN_FULFILLMENT_ADDRESS,
    turnstile: process.env.MYNEWCHAIN_TURNSTILE_ADDRESS,
  },
}
```

2. Update `SUPPORTED_CHAIN_PAIRS` to include the new chain with NEAR

3. Add environment variables for RPC URL and contract addresses

4. The existing EVM adapter will automatically work with the new chain

## Monitoring and Observability

The relayer provides extensive logging and monitoring:

- Structured JSON logging with Winston
- Health check endpoint with chain status
- Metrics for order processing and error rates
- Event emission for external monitoring systems

## Security Considerations

- All resolver interactions require KYC verification
- Secret revelation is conditional on escrow verification
- Timelock enforcement prevents fund lockup
- Safety deposits incentivize proper resolver behavior
- Rate limiting and input validation on all endpoints

## Production Deployment

For production deployment:

1. Use environment-specific configurations
2. Enable Redis for session management
3. Configure proper logging and monitoring
4. Set up load balancing for high availability
5. Use HTTPS with proper SSL certificates
6. Configure firewalls and network security

## Contributing

1. Follow the DRY and KISS principles
2. Maintain comprehensive test coverage
3. Update documentation for any API changes
4. Follow the established code style and patterns

## License

MIT License - see LICENSE file for details
