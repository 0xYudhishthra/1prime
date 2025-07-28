# 1Prime Relayer Service

A 1inch Fusion+ compatible relayer service that facilitates cross-chain atomic swaps between EVM chains (Ethereum, Base, BSC, Polygon, Arbitrum) and NEAR Protocol.

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

### Configuration

Create a `.env` file based on the example:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development
SUPPORTED_CHAINS=ethereum,near

# Chain RPC URLs
ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY
NEAR_RPC_URL=https://rpc.mainnet.near.org

# Contract Addresses (update with deployed contract addresses)
ETHEREUM_HTLC_ADDRESS=0x...
ETHEREUM_FULFILLMENT_ADDRESS=0x...
ETHEREUM_TURNSTILE_ADDRESS=0x...
NEAR_HTLC_ADDRESS=htlc.1prime.near
NEAR_FULFILLMENT_ADDRESS=fulfillment.1prime.near
NEAR_TURNSTILE_ADDRESS=turnstile.1prime.near

# Private keys for transaction signing
# Single EVM private key used for all EVM chains (Ethereum, Base, BSC, Polygon, Arbitrum)
EVM_PRIVATE_KEY=your_evm_private_key
NEAR_PRIVATE_KEY=your_near_private_key
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
