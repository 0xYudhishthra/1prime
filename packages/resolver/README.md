# 1Prime Resolver

The Resolver is a critical component of the 1Prime cross-chain swap system, built using NEAR's Shade Agent Framework and deployed in a Trusted Execution Environment (TEE). It acts as a decentralized solver that integrates with 1inch Fusion+ for cross-chain swaps between EVM chains and NEAR.

## Overview

The Resolver serves as the bridge between EVM and NEAR ecosystems, handling:
- Cross-chain order execution
- Hashlock and timelock functionality preservation
- Secure fund management through TEE
- Integration with 1inch Fusion+ meta-orders

## Architecture

The Resolver operates within a TEE to ensure trustless execution and maintains:
- **EVM Wallet**: For handling Ethereum-based transactions
- **NEAR Wallet**: For handling NEAR protocol transactions
- **Order Processing**: Polling and executing cross-chain swap orders
- **Escrow Management**: Deploying and managing escrow contracts

## Cross-Chain Swap Process

The Resolver participates in the following workflow:

1. **Order Acceptance**: Polls the Relayer for new Fusion+ orders
2. **Order Claiming**: Submits confirmation via `/orders/{hash}/claim`
3. **Escrow Deployment**: Deploys escrow contracts on both chains
4. **State Updates**: Updates order state via `/orders/{hash}/escrow-deployed`
5. **Secret Revelation**: Processes secret reveals to unlock funds
6. **Fund Release**: Completes the cross-chain transfer

## How to Build

1. Ensure you have Docker installed
2. Set up NEAR's Shade Agent Framework environment
3. Configure TEE deployment settings
4. Build and deploy the Resolver container

## Endpoints

The Resolver exposes the following API endpoints:

### Wallet Information
```
GET /api/eth/get_address
```
Returns the EVM address held by this TEE instance.

```
GET /api/near/get_address  
```
Returns the NEAR address held by this TEE instance.

### Balance Queries
```
GET /api/eth/get_balance
```
Returns the current EVM balance (ETH and ERC-20 tokens) held by the TEE's address.

```
GET /api/near/get_balance
```
Returns the current NEAR balance (NEAR and NEP-141 tokens) held by the TEE's address.

## Integration with 1inch Fusion+

The Resolver implements the 1inch Fusion+ solver interface, supporting:
- Meta-order format compatibility
- Hashlock/timelock preservation for non-EVM chains
- Bidirectional swap functionality (EVM ↔ NEAR)
- Partial fill capabilities (stretch goal)

## Security Features

- **TEE Deployment**: Ensures trustless execution environment
- **Chain Signatures**: Uses NEAR's Chain Signatures for secure transaction signing
- **Hashlock/Timelock**: Implements atomic swap guarantees
- **Escrow Contracts**: Secure fund holding during swap process

## Development Notes

This Resolver is designed for the 1inch hackathon submission, targeting multiple tracks:
- Extend Fusion+ to Near
- Build a full Application using 1inch APIs  
- Best 1inch Fusion+ Solver Built with NEAR's Shade Agent Framework