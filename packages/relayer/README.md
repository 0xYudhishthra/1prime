# 1Prime Relayer Service

A production-ready relayer service implementing the 1inch Fusion+ cross-chain atomic swap protocol between Ethereum Virtual Machine (EVM) chains and NEAR Protocol. This implementation extends the 1inch Fusion+ architecture to enable bidirectional cross-chain token swaps while preserving the hashlock and timelock security mechanisms outlined in the 1inch Fusion+ whitepaper.

## Architecture Overview

The relayer service acts as an intermediary that facilitates secure atomic swaps between EVM chains (Ethereum, Base, BSC, Polygon, Arbitrum) and NEAR Protocol. The system maintains the core security properties of Hash Time Locked Contracts (HTLCs) while adapting the 1inch Fusion+ auction mechanism for cross-chain environments.

### Core Components

#### Service Layer (`src/services/`)

**`relayer.ts`** - Central orchestration service that coordinates the entire cross-chain swap process. Implements the main business logic for order lifecycle management, escrow verification, and cross-chain communication. Handles the integration between 1inch Fusion+ SDK orders and NEAR Protocol contracts while maintaining atomic swap guarantees.

**`database.ts`** - Database abstraction layer providing persistent storage for order states, escrow information, and swap metadata. Implements atomic operations for order claiming to prevent race conditions and double-spending attacks. Includes backward compatibility mechanisms for schema evolution.

**`order-manager.ts`** - Manages order state transitions and lifecycle events. Tracks orders through phases from submission to completion, handling timeouts and error conditions. Provides in-memory caching and event emission for real-time updates.

**`secret-manager.ts`** - Secure management of preimage secrets and hash verification. Implements the cryptographic primitives required for hashlock functionality, ensuring secrets are only revealed when escrow conditions are safely met.

#### API Layer (`src/api/`)

**`routes.ts`** - RESTful API implementation providing all endpoints required for the cross-chain swap flow. Implements comprehensive input validation, error handling, and response formatting. Follows the standardized request patterns (GET with URL parameters, POST with request body).

#### Type System (`src/types/`)

**`index.ts`** - Comprehensive TypeScript definitions for all data structures, API requests/responses, and internal state objects. Ensures type safety across the entire application and provides clear contracts for external integrations.

#### API Documentation

**`openapi.yaml`** - Complete OpenAPI 3.0 specification documenting all endpoints, request/response schemas, and integration examples. Provides interactive documentation and serves as the definitive API contract.

### SDK Integration and Patches

**`patches/@1inch+cross-chain-sdk+0.1.15.patch`** - Critical patch that extends the 1inch Cross-Chain SDK to support NEAR Protocol by adding chain IDs 397 (NEAR Mainnet) and 398 (NEAR Testnet) to the supported chains enumeration. This patch enables the core cross-chain functionality required for the bounty requirements.

**`package.json`** - Dependency management with specialized patching configuration for Bun/npm compatibility. Includes post-install hooks to apply SDK patches automatically across different deployment environments.

## Bounty Qualification Features

### 1. Hashlock and Timelock Preservation

The implementation maintains the cryptographic security guarantees of the original 1inch Fusion+ protocol:

- **Hashlock Mechanism**: Secret hash verification ensures atomic reveals across chains
- **Timelock Protection**: Configurable time windows prevent indefinite fund locking
- **Cross-Chain Coordination**: Synchronized escrow states between EVM and NEAR

### 2. Bidirectional Swap Support

The relayer supports swaps in both directions:

- **EVM → NEAR**: Ethereum/L2 tokens to NEAR Protocol tokens
- **NEAR → EVM**: NEAR Protocol tokens to Ethereum/L2 tokens
- **Multi-Chain EVM Support**: Ethereum, Base, BSC, Polygon, Arbitrum

### 3. Onchain Execution Capability

The system provides comprehensive on-chain verification and execution:

- **EVM Escrow Verification**: Direct contract interaction using 1inch escrow ABIs
- **NEAR Contract Integration**: Native NEAR API calls for escrow state verification
- **Transaction Monitoring**: Block-level verification of escrow deployments
- **Balance Verification**: Real-time token balance checks before secret revelation

### 4. Partial Fill Support (Stretch Goal)

The architecture includes support for partial order fulfillment:

- **Merkle Tree Secret Management**: N+1 secret structure for partial reveals
- **Auction Mechanism**: Time-based rate adjustments for competitive filling
- **State Tracking**: Granular order status management for partial completions

## API Endpoint Flow

The relayer implements the complete cross-chain swap workflow through RESTful endpoints:

1. **Order Preparation** (`POST /orders/prepare`) - Generates unsigned Fusion+ orders
2. **Order Submission** (`POST /orders/submit`) - Accepts signed orders from users
3. **Order Claiming** (`POST /orders/{hash}/claim`) - Allows resolvers to claim orders
4. **Status Monitoring** (`GET /orders/{hash}/status`) - Real-time order state tracking
5. **Escrow Confirmation** (`POST /orders/{hash}/escrow-deployed`) - Deployment verification
6. **Safety Verification** (`GET /orders/{hash}/verify-escrows`) - Pre-reveal security checks
7. **Secret Revelation** (`POST /orders/{hash}/reveal-secret`) - Atomic swap completion

## Available Scripts

- `npm run build` - Compile TypeScript to production JavaScript
- `npm run dev` - Start development server with hot reload
- `npm run start` - Run production server
- `npm run patch` - Apply 1inch SDK patches for NEAR support
- `npm run postinstall` - Automatic patch application during installation

## Technical Implementation Details

### Cross-Chain State Management

The relayer maintains synchronized state across multiple blockchains through:

- **Phase-Based Transitions**: Clear state machine for order progression
- **Atomic Database Operations**: Prevents race conditions in multi-resolver environments
- **Event-Driven Architecture**: Real-time updates via WebSocket connections
- **Comprehensive Logging**: Full audit trail for debugging and monitoring

### Security Mechanisms

- **Independent Escrow Verification**: Multi-chain validation before secret revelation
- **Double-Claim Prevention**: Atomic order claiming with database constraints
- **Timeout Management**: Automatic order expiration and fund recovery
- **Input Validation**: Comprehensive parameter checking and sanitization

### Performance Optimizations

- **Efficient Database Queries**: Optimized for high-frequency order status checks
- **Connection Pooling**: Managed blockchain RPC connections
- **Caching Strategy**: In-memory state caching for frequently accessed data
- **Parallel Processing**: Concurrent escrow verification across chains

This implementation demonstrates a production-ready extension of the 1inch Fusion+ protocol that successfully bridges EVM and NEAR ecosystems while maintaining all security guarantees required for trustless cross-chain atomic swaps.
