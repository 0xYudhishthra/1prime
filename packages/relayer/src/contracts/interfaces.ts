import { Interface } from "ethers";

// Standard ERC20 Interface - reusable across the app
export const ERC20_INTERFACE = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

// 1inch Cross-Chain Escrow Interface
export const ESCROW_INTERFACE = new Interface([
  "function FACTORY() view returns (address)",
  "function RESCUE_DELAY() view returns (uint256)",
  "function PROXY_BYTECODE_HASH() view returns (bytes32)",
  "event Withdrawal(bytes32 secret)",
  "event EscrowCancelled()",
  "event FundsRescued(address token, uint256 amount)",
  "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables)",
  "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables)",
]);

// Contract addresses by chain
export const CONTRACT_ADDRESSES = {
  ethereum: {
    escrowFactory: "0x...", // Replace with actual addresses
  },
  base: {
    escrowFactory: "0x...",
  },
  polygon: {
    escrowFactory: "0x...",
  },
} as const;
