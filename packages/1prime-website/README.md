# 1Prime Website

The frontend application for **1Prime** - a cross-chain swap platform that enables seamless token swaps between EVM chains and NEAR Protocol, powered by 1inch Fusion+ intent-based atomic swaps.

## Overview

This website serves as the primary interface for the 1Prime ecosystem, built specifically for hackathon submission targeting multiple 1inch tracks including Fusion+ extension to NEAR and comprehensive 1inch API integration.

## Core Features

### 🔐 User Authentication
- **Dual Wallet Generation**: Automatically creates both EVM smart wallets (via ZeroDev) and NEAR wallets upon signup
- **Bearer Token System**: Links both wallets for seamless cross-chain operations
- **Session Management**: Secure token-based authentication for all interactions

### 💰 Wallet Management
- **Multi-Chain Balance Display**: View EVM and NEAR balances in real-time
- **Token Support**: Full support for ERC-20 and NEP-141 tokens
- **Live Updates**: Real-time balance synchronization across chains

### 📥 Deposit Interface
- **EVM Deposits**: Display smart wallet addresses for token deposits
- **NEAR Deposits**: Show account IDs for NEAR-based token deposits
- **QR Code Generation**: Easy-to-use deposit address sharing

### 🔄 Cross-Chain Swaps
- **Intent-Based Swaps**: Leveraging 1inch Fusion+ for atomic cross-chain operations
- **Apple Shortcuts Integration**: Unique voice-controlled swap functionality via Siri
- **Real-Time Status**: Live order tracking and status updates

## Unique Feature: Apple Shortcuts Integration

### Voice Commands Available:
- **"Login to 1Prime"**: Authenticate and save session token
- **"View Wallet"**: Display live balances from both chains
- **"Deposit Token"**: Show wallet addresses for deposits

### How It Works:
1. Auth tokens are saved to `Downloads/` folder for session reuse
2. Shortcuts communicate with the website API for real-time data
3. Voice commands trigger specific app functions without manual navigation

## Cross-Chain Swap Flow

The website handles the complete swap lifecycle:

1. **Order Preparation**: Generate secret hash and prepare swap parameters
2. **Fusion+ Integration**: Create and sign 1inch Fusion+ orders
3. **Order Submission**: Submit signed orders to the relayer network
4. **Status Monitoring**: Real-time polling for order status updates
5. **Escrow Verification**: Ensure safe execution before secret reveal
6. **Completion**: Automatic fund unlocking upon successful verification

## Tech Stack

- **Frontend Framework**: [Your framework here]
- **Wallet Integration**: ZeroDev for EVM, NEAR SDK for NEAR Protocol
- **API Integration**: Comprehensive 1inch API usage
- **Cross-Chain**: 1inch Fusion+ with custom NEAR extensions

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## API Endpoints

The website interacts with these key endpoints:
- `POST /orders/prepare` - Prepare cross-chain swap orders
- `POST /orders/submit` - Submit signed Fusion+ orders
- `GET /orders/{hash}/status` - Monitor swap progress
- `POST /orders/{hash}/reveal-secret` - Complete swap execution

## Hackathon Tracks

This website contributes to multiple 1inch hackathon tracks:

1. **Extend Fusion+ to Near**: Frontend interface for cross-chain swaps
2. **Full Application using 1inch APIs**: Comprehensive API integration
3. **Best 1inch Fusion+ Solver**: User interface for TEE-based solver interactions

## Development

### Prerequisites
- Node.js 18+
- Access to EVM and NEAR testnets
- 1inch API credentials

### Environment Variables
```env
NEXT_PUBLIC_1INCH_API_KEY=your_api_key
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_EVM_RPC_URL=your_rpc_url
```

## Contributing

This project is part of a hackathon submission. For the complete ecosystem, see the main [1Prime repository](../../README.md).

## License

[Your License Here]

