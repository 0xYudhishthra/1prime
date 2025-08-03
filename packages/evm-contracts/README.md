# 1Prime EVM Contracts

Smart contracts for **1Prime** - enabling cross-chain swaps between EVM chains and NEAR, powered by **1inch Fusion+** intent-based atomic swaps.

## Overview

This package contains the EVM smart contracts that implement the cross-chain swap functionality for 1Prime. The contracts handle:

- **Escrow contracts** with hashlock and timelock functionality
- **Smart wallet integration** via ZeroDev
- **1inch Fusion+ protocol** integration for intent-based swaps
- **Cross-chain state management** for NEAR interoperability

## Architecture

The contracts preserve hashlock and timelock functionality required for secure cross-chain swaps:
- Users lock funds in escrow contracts on the source EVM chain
- Funds are unlocked using secret reveals or timelock expiration
- Integration with 1inch Limit Order Protocol for atomic swap execution

## Development Setup

Built with **Foundry** - a blazing fast, portable and modular toolkit for Ethereum application development.

### Build

```shell
forge build
```

### Test

```shell
forge test
```

### Format

```shell
forge fmt
```

### Gas Snapshots

```shell
forge snapshot
```

## Local Development

### Start Local Node

```shell
anvil
```

### Deploy Contracts

```shell
forge script script/Deploy.s.sol --rpc-url <rpc_url> --private-key <private_key>
```

## Testing

Run the full test suite:

```shell
forge test -vvv
```

Run specific test files:

```shell
forge test --match-contract EscrowTest
```

## Contract Deployment

For hackathon demo, contracts will be deployed on EVM testnets with 1inch Limit Order Protocol contracts.

### Supported Networks
- Ethereum Sepolia
- Polygon Mumbai
- Other EVM-compatible testnets

## Integration

These contracts integrate with:
- **1inch Fusion+** for intent-based atomic swaps
- **ZeroDev** for smart wallet functionality
- **NEAR Protocol** for cross-chain interoperability

## Documentation

- [Foundry Documentation](https://book.getfoundry.sh/)
- [1inch Fusion+ Documentation](https://docs.1inch.io/)
- [Project Context](../CONTEXT.md)

## Help

```shell
forge --help
anvil --help
cast --help
```
