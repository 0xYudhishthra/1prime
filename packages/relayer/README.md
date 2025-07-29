# 1Prime Relayer Service

A 1inch Fusion+ compatible relayer service that facilitates cross-chain atomic swaps between EVM chains (Ethereum, Base, BSC, Polygon, Arbitrum) and NEAR Protocol.

This implementation follows the 1inch Fusion+ whitepaper architecture with **per-swap HTLC deployment**: each atomic swap gets its own pair of HTLC contracts deployed dynamically by resolvers during Phase 2, exactly as specified in the whitepaper. This removes static singleton contracts while maintaining the core auction and secret revelation mechanisms.

## Overview

This relayer service implements the complete 1inch Fusion+ protocol as described in their [whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf), with extended support for EVM <> NEAR cross-chain swaps. It provides:

- **Dutch Auction Management**: Competitive bidding system with gas-adjusted custom curves (Section 2.3.4)
- **Partial Fill Support**: Merkle tree-based N+1 secret management for partial order execution (Section 2.5)
- **Escrow Verification**: Contract deployment and balance checking across chains
- **Secret Management**: Secure handling and conditional disclosure of HTLC secrets with Merkle tree support
- **Timelock Management**: Phase transition logic following 1inch Fusion+ specifications
- **Gas Price Adaptation**: Dynamic auction curve adjustments based on network conditions
- **Real-time Updates**: WebSocket support for live order tracking and auction progress
- **Modular Chain Support**: Extensible architecture for adding new EVM chains

## Architecture

### Core Components

1. **Order Manager**: Handles order creation, Dutch auctions, and resolver bidding with SDK integration
2. **Partial Fill Manager**: Manages N+1 Merkle tree secrets for partial order execution (Section 2.5)
3. **Custom Curve Manager**: Dynamic auction curves with gas price adjustments (Section 2.3.4)
4. **Escrow Verifier**: Monitors per-swap HTLC contracts and balance verification
5. **Secret Manager**: Manages secret storage, Merkle trees, and conditional revelation
6. **Timelock Manager**: Enforces phase transitions and timing constraints
7. **Chain Adapters**: Modular interfaces for EVM and NEAR blockchain interactions
8. **Database Service**: Persistent storage for orders, resolvers, and auction states
9. **WebSocket Service**: Real-time event broadcasting and subscription management

### HTLC Contract Architecture

Following the 1inch Fusion+ specification:

- **Phase 1 (Announcement)**: Orders created without HTLC addresses
- **Phase 2 (Deposit)**: Resolvers deploy dedicated HTLC contracts for each swap
- **Database Tracking**: `sourceChainHtlcAddress` and `destinationChainHtlcAddress` fields track per-swap contracts
- **Dynamic Management**: All escrow operations use the specific contract addresses for each order

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

Copy the example environment file and configure your variables:

```bash
cp env.example .env
```

Edit `.env` with your configuration. Key variables include:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` for database
- `EVM_PRIVATE_KEY` and `NEAR_PRIVATE_KEY` for transaction signing
- RPC URLs for supported chains
- `PORT` and `LOG_LEVEL` for server configuration

See `env.example` for the complete list of required environment variables.

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

Supports both legacy and SDK order formats with automatic detection:

**Legacy Format (Backward Compatible)**:

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

**SDK Format (Enhanced Features)**:

```http
POST /orders
Content-Type: application/json

{
  "sdkOrder": {
    "orderInfo": {
      "srcChainId": "1",
      "dstChainId": "near",
      "srcToken": "0x...",
      "dstToken": "near",
      "srcAmount": "1000000000000000000",
      "dstAmount": "100000000000000000000000000"
    },
    "auctionDetails": {
      "points": [
        { "delay": 0, "coefficient": 1.0 },
        { "delay": 60, "coefficient": 0.5 },
        { "delay": 120, "coefficient": 0.0 }
      ]
    },
    "settlementInfo": {
      "hashLock": {
        "merkleRoot": "0x...",
        "merkleLeaves": ["0x...", "0x...", "0x..."],
        "secretHash": "0x..."
      }
    }
  },
  "signature": "0x..."
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

#### Partial Fill Management

**Submit Partial Fill**:

```http
POST /partial-fills
Content-Type: application/json

{
  "orderHash": "0x...",
  "resolver": "0x...",
  "fillAmount": "25000000",
  "proposedSecretIndex": 2,
  "signature": "0x..."
}
```

**Get Partial Fill Status**:

```http
GET /partial-fills/{orderHash}
```

Returns:

```json
{
  "success": true,
  "data": {
    "orderHash": "0x...",
    "totalAmount": "100000000",
    "filledAmount": "75000000",
    "fillPercentage": 75,
    "fillParts": 4,
    "secretsUsed": [2, 3],
    "availableSecrets": [1, 4, 5],
    "isCompleted": false,
    "fills": [
      {
        "fillId": "0x...-1640995200000",
        "resolver": "0x...",
        "amount": "50000000",
        "secretIndex": 2,
        "fillPercentage": 50,
        "timestamp": 1640995200000
      }
    ]
  }
}
```

#### Gas Adjustment Monitoring

**Get Gas Summary**:

```http
GET /gas-summary
```

Returns current gas conditions and adjustment statistics:

```json
{
  "success": true,
  "data": {
    "currentBaseFeeGwei": 25.5,
    "activeOrders": 12,
    "adjustmentsToday": 45
  }
}
```

## WebSocket Real-Time Updates

The relayer provides WebSocket support for real-time order tracking and updates.

### Connection

Connect to the WebSocket server:

```javascript
const ws = new WebSocket("ws://localhost:3001/ws");

ws.onopen = () => {
  console.log("Connected to 1Prime relayer WebSocket");
};

ws.onmessage = event => {
  const update = JSON.parse(event.data);
  console.log("Real-time update:", update);
};
```

### Event Subscription

Subscribe to specific events:

```javascript
// Subscribe to general events
ws.send(
  JSON.stringify({
    type: "subscribe_events",
    events: [
      "order_created",
      "auction_progress",
      "partial_fill",
      "gas_adjustment",
    ],
  })
);

// Subscribe to specific order updates
ws.send(
  JSON.stringify({
    type: "subscribe_order",
    orderHash: "0x...",
  })
);
```

### Supported Events

- `order_created` - New order submitted
- `auction_started` - Dutch auction begins
- `auction_progress` - Real-time rate updates
- `gas_adjustment` - Gas price changes affecting rates
- `partial_fill` - Partial fill completed
- `auction_won` - Resolver wins auction
- `secret_revealed` - Secret disclosed for completion
- `order_completed` - Order finalized
- `order_cancelled` - Order cancelled
- `phase_transition` - Timelock phase changes

### Example Usage

```javascript
const ws = new WebSocket("ws://localhost:3001/ws");

ws.onopen = () => {
  // Subscribe to auction events
  ws.send(
    JSON.stringify({
      type: "subscribe_events",
      events: ["auction_progress", "partial_fill"],
    })
  );
};

ws.onmessage = event => {
  const { event: eventType, data, orderHash } = JSON.parse(event.data);

  switch (eventType) {
    case "auction_progress":
      console.log(`Order ${orderHash} rate: ${data.currentRate}`);
      break;
    case "partial_fill":
      console.log(`Order ${orderHash} filled: ${data.fillPercentage}%`);
      break;
  }
};
```

### WebSocket Info Endpoint

Get WebSocket connection details:

```http
GET /ws-info
```

Returns WebSocket configuration and supported events.

## Protocol Flow

### Phase 1: Announcement (Enhanced)

1. **Order Creation**: Maker signs order (legacy or SDK format)
   - **SDK Orders**: Extract Merkle tree, custom curves, safety deposits
   - **Legacy Orders**: Use default linear auction curve
2. **Feature Initialization**:
   - **Partial Fills**: Initialize N+1 secret tracking if enabled
   - **Custom Curves**: Set up gas-adjusted price curves
   - **Database Storage**: Persist order with all extracted data
3. **Dutch Auction Start**: Competition begins with dynamic pricing
   - **Gas Monitoring**: Real-time gas price tracking starts
   - **Curve Adjustment**: Dynamic rate modification based on network conditions
   - **Resolver Competition**: KYC'd resolvers compete for profitable orders

### Phase 2: Deposit (Per-Swap HTLCs)

1. **Winning Resolver Selection**: First profitable bidder wins
2. **Dynamic HTLC Deployment**: Resolver deploys dedicated contracts for this swap
   - **Source Chain HTLC**: Contains maker's assets + safety deposit
   - **Destination Chain HTLC**: Contains resolver's assets + safety deposit
3. **Relayer Verification**:
   - **Contract Verification**: Confirms HTLC deployments with correct parameters
   - **Balance Verification**: Ensures proper amounts and safety deposits
   - **Database Update**: Store HTLC addresses for this specific order
4. **Finality Lock**: Security period to prevent reorganization attacks

### Phase 3: Withdrawal (Enhanced Secret Management)

1. **Secret Revelation**: After finality lock expires
   - **Single Fill**: Reveal primary secret to all resolvers
   - **Partial Fill**: Reveal specific secret based on fill percentage
   - **Merkle Proof**: Provide proof for partial fill secrets
2. **Withdrawal Execution**:
   - **Exclusive Period**: Winning resolver has priority withdrawal time
   - **Partial Completion**: Track cumulative fills and remaining amounts
   - **Safety Deposit Claims**: Executors claim incentive deposits
3. **Public Withdrawal**: If resolver fails, any resolver can complete
   - **Automatic Progression**: System handles timelock phase transitions
   - **Incentive Preservation**: Safety deposits ensure completion

### Phase 4: Recovery (Safety Mechanisms)

1. **Timeout Handling**: If swap cannot complete
   - **Automatic Cancellation**: System triggers fund recovery
   - **Safety Deposit Distribution**: Incentivize proper cancellation
   - **Partial Fill Recovery**: Handle incomplete partial fills
2. **Gas Emergency Recovery**: If gas prices make execution impossible
   - **Curve Adjustment**: Attempt to make order profitable again
   - **Extended Timeout**: Allow more time for execution
   - **Manual Intervention**: Fallback to standard recovery

## Testing

The relayer includes comprehensive tests covering:

- API endpoint validation and error handling
- Order lifecycle management (legacy and SDK formats)
- Dutch auction mechanics with gas adjustments
- Partial fill processing and Merkle tree management
- Custom curve interpolation and gas price adaptation
- Secret management and conditional disclosure
- Timelock phase transitions and enforcement
- Chain adapter functionality (EVM and NEAR)
- Database persistence and state management

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode during development
npm run test:watch

# Test specific features
npm run test -- --grep "partial fills"
npm run test -- --grep "gas adjustment"
npm run test -- --grep "SDK order"
```

### Test Coverage

- **Unit Tests**: Individual service and manager testing
- **Integration Tests**: End-to-end order processing
- **Whitepaper Compliance**: Validates exact specification adherence
- **Performance Tests**: Concurrent order handling
- **Error Scenarios**: Edge cases and failure modes

## Whitepaper Compliance

This implementation follows the [1inch Fusion+ whitepaper](https://1inch.io/assets/1inch-fusion-plus.pdf) specifications. See `WHITEPAPER_COMPLIANCE_EXAMPLES.md` for detailed examples and compliance verification.

## Monitoring and Observability

- Structured JSON logging with Winston
- Health check endpoint (`GET /health`)
- Event emission for external monitoring systems
- Real-time WebSocket updates with subscription-based filtering
- Gas monitoring and auction progress tracking via WebSocket events

## Security Considerations

- All resolver interactions require KYC verification
- Secret revelation is conditional on escrow verification
- Timelock enforcement prevents fund lockup
- Input validation on all endpoints
- Signature verification for orders
- Secure private key management

## Production Deployment

For production deployment:

1. Use environment-specific configurations
2. Configure proper logging and monitoring
3. Set up load balancing for high availability
4. Use HTTPS with proper SSL certificates
5. Configure firewalls and network security

## Contributing

1. Follow the DRY and KISS principles
2. Maintain comprehensive test coverage
3. Update documentation for any API changes
4. Follow the established code style and patterns

## License

MIT License - see LICENSE file for details
