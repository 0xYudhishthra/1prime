We’re building an app (known as 1Prime) that enables **cross-chain swaps between EVM chains and NEAR**, powered by **1inch Fusion+** (intent-based atomic swaps). This project is meant for a hackathon submission.

### Core UX features:

1. **User Authentication**
    - Upon signup, we generate:
        - **EVM smart wallets** (via ZeroDev)
        - **NEAR wallets**
    - A **bearer token** is issued to link both wallets for all future interactions.
2. **View Wallet**
    - Display EVM and NEAR balances, including all **ERC-20** and **NEP-141** tokens.
3. **Deposit Tokens**
    - Show deposit addresses:
        - **EVM**: smart wallet address
        - **NEAR**: account ID
4. **Swap**
    - Initiate and complete cross-chain swaps.

### Unique Feature: Apple Shortcuts Integration

Users can control the app via Siri voice commands.

- **Login to 1Prime**
    - Auth token is saved to `Downloads/` folder for session reuse across other shortcuts.
    - Not ideal security-wise, but effective for validating user sessions.
- **View Wallet**
    - Displays live token balances from both chains.
- **Deposit Token**
    - Presents corresponding wallet addresses for EVM/NEAR deposits.

### About cross-chain swap

We only allow the users to swap via Apple Shortcuts.

1. Generate random number (Frontend)
2. Hash random number using Keccak-256 (Frontend)
    1. Sign using user’s wallet.
3. Post to `/orders/prepare`, these are the params for your context (don’t have to mention it in the demo)
    1. userSrcAddress
    2. userDstAddress
    3. amount
    4. fromToken
    5. toToken
    6. fromChain
    7. toChain
    8. secretHash
4. Relayer creates Fusion+ order with patched 1inch Fusion+ SDK
5. Relayer returns the Fusion+ order
    1. Sign using user’s wallet
    2. It contains the `orderHash` the operation need to keep track of
6. Frontend send the signed Fusion+ order back to Relayer by posting to `/orders/submit`
7. Resolver accepts the order by polling Relayer, and submitting the confirmation using `/orders/{hash}/claim`
8. Frontend poll `/orders/{hash}/status` every 2 seconds, and check the order status
9. Resolver updates state after completion by calling `/orders/{hash}/escrow-deployed`
    1. Update the state to “complete” once source chain and destination chain escrows deployed
10. Frontend checks if it is safe to reveal the secret using `/orders/{hash}/verify-escrow`
11. If safe to proceed, frontend sends the generated random number to `/orders/{hash}/reveal-secret` after detecting the state changes from frontend
12. Relayer broadcasts to every resolver
13. Resolver unlocks funds

---

### Tracks we targeting:

- Extend Fusion+ to Near
    - Requirements:
        - Preserve hashlock and timelock functionality for the non-EVM implementation
        - Swap functionality should be bidirectional (swaps should be possible to and from Ethereum)
        - Onchain (mainnet/L2 or testnet) execution of token transfers should be presented during the final demo (EVM testnets will require the deployment of Limit Order Protocol contracts)
    - Stretch goals (not hard requirements):
        - UI
        - Enable partial fills
- Build a full Application using 1inch APIs
    - 1inch offers a variety of REST APIs that make building onchain applications simpler. Create a full dApp using as many 1inch APIs as possible.
    Example integration points:
        - Add swap functionality with one of our swap protocols (1inch Cross-chain Swap (Fusion+), Intent-based Swap (Fusion), Classic Swap, or Limit Order protocol)
        - Source onchain data using our data APIs (price feeds API, wallet balances API, token metadata API, and many more)
        - Post transactions our Web3 API to interact with the blockchain
    - Qualification Requirements
        - Application should use 1inch API as much as possible
        - Consistent commit history should be in the GitHub project. No low or single-commit entries allowed!
- Best 1inch Fusion+ Solver Built with NEAR's Shade Agent Framework
    - Build a decentralized solver that integrates with 1inch Fusion+ for cross-chain swaps using NEAR's Shade Agent Framework and Trusted Execution Environment.
    - There is an existing decentralized NEAR Intents solver here:
    Solver manager and deployer https://github.com/Near-One/tee-solver/
    Solver https://github.com/think-in-universe/near-intents-tee-amm-solver/tree/feat/tee-solver
    - It listens for intents, generates quotes, and submits them for execution on NEAR Intents. Your task is to build a similar system that works with 1inch Fusion+ and its meta-order format. Make sure the solver is created using NEAR’s Shade Agent Framework and is deployed in a Trusted Execution Environment.
    - The Shade Agent Framework allows you to build decentralized solvers, enabling users to delegate and provide liquidity to solvers without requiring trust that the solver will behave correctly or having to set up their own solver.
    - Qualification Requirements
    - Your solver must listen for quote requests (mocked or real), produce valid 1inch Fusion meta-orders using NEAR's Chain Signatures, include comprehensive documentation with setup instructions, and demonstrate end-to-end functionality. Bonus points for modular architecture that extends to other protocols.