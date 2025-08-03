// Cross-chain swap request and response types based on 1Prime relayer API

/**
 * Cross-chain swap request - supports USDC swaps between supported chains
 * 
 * Frontend sends minimal user-friendly values, API auto-assigns USDC addresses and normalizes for relayer:
 * 
 * Chain Names (case-insensitive):
 * - "ethereum"/"Ethereum" → "11155111" (Ethereum Sepolia)
 * - "arbitrum"/"Arbitrum" → "421614" (Arbitrum Sepolia)  
 * - "optimism"/"Optimism" → "11155420" (Optimism Sepolia)
 * - "near"/"Near" → "398" (NEAR Testnet)
 * - "near-mainnet" → "mainnet" (NEAR Mainnet)
 * 
 * Amount Conversion:
 * - Frontend: "10" (10 USDC) → API: "10000000" (10 * 10^6 for 6 decimals)
 * 
 * USDC Addresses (auto-assigned by API):
 * - ETH Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 * - NEAR Testnet: 3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af
 */
export interface CrossChainSwapRequest {
  amount: string;    // User-friendly amount (e.g., "10" for 10 USDC, gets converted to "10000000")
  fromChain: string; // Chain name, case-insensitive (e.g., "ethereum", "arbitrum", "optimism", "near", "near-mainnet")
  toChain: string;   // Chain name, case-insensitive (e.g., "ethereum", "arbitrum", "optimism", "near", "near-mainnet")
  relayerUrl?: string; // Optional, defaults to production relayer
  
  // Internal fields (auto-assigned by API, not sent by frontend)
  fromToken?: string; // USDC contract address (auto-assigned)
  toToken?: string;   // USDC contract address (auto-assigned)
}

export interface GenerateOrderRequest {
  userAddress: string;
  amount: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  secretHash: string;
}

export interface SubmitSignedOrderRequest {
  orderHash: string;
  signature: string;
}

export interface SecretRevealRequest {
  orderHash: string;
  secret: string;
  proof: string;
  signature: string;
}

// Relayer API Response Types
export interface RelayerApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface PrepareOrderResponse {
  orderHash: string;
  success: boolean;
  message: string;
}

export interface OrderStatusResponse {
  orderHash: string;
  phase: OrderPhase;
  sourceEscrow?: EscrowDetails;
  destinationEscrow?: EscrowDetails;
  auction?: DutchAuctionState;
  secret?: SecretManagement;
  timelock?: TimelockPhase;
  isCompleted: boolean;
  events?: OrderEvent[];
}

export interface EscrowVerificationResponse {
  safe: boolean;
  orderHash: string;
  verification: {
    srcEscrowVerified: boolean;
    dstEscrowVerified: boolean;
    srcEscrowDetails?: EscrowVerificationDetails;
    dstEscrowDetails?: EscrowVerificationDetails;
    issues?: string[];
  };
  message: string;
}

export interface EscrowVerificationDetails {
  escrowAddress: string;
  chainName: string;
  contractExists: boolean;
  amountMatches: boolean;
  tokenMatches: boolean;
  secretHashMatches: boolean;
  properlyFunded: boolean;
}

// Order Status Types
export type OrderPhase = 
  | 'preparing'
  | 'signed'
  | 'submitted'
  | 'claimed'
  | 'src_escrow_deployed'
  | 'dst_escrow_deployed'
  | 'waiting-for-secret'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface EscrowDetails {
  orderHash: string;
  chain: string;
  contractAddress: string;
  secretHash: string;
  amount: string;
  timeout: number;
  creator: string;
  designated: string;
  isCreated: boolean;
  isWithdrawn: boolean;
  isCancelled: boolean;
  createdAt: number;
  withdrawnAt?: number;
  cancelledAt?: number;
  transactionHash?: string;
}

export interface DutchAuctionState {
  orderHash: string;
  startTime: number;
  duration: number;
  initialRateBump: number;
  currentRate: number;
  isActive: boolean;
  winner?: string;
  finalRate?: number;
  participatingResolvers: string[];
}

export interface SecretManagement {
  orderHash: string;
  secret?: string;
  secretHash: string;
  isRevealed: boolean;
  revealedAt?: number;
  revealedBy?: string;
  merkleTree?: any;
}

export interface TimelockPhase {
  phase: OrderPhase;
  orderHash: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  nextPhase?: string;
}

export interface OrderEvent {
  type: 'order_created' | 'order_updates' | 'auction_started' | 'auction_progress' | 
        'auction_won' | 'phase_transition' | 'secret_revealed' | 'order_completed' | 
        'order_cancelled' | 'error';
  timestamp: number;
  data?: any;
  transactionHash?: string;
  blockNumber?: number;
}

// Internal tracking types
export interface CrossChainOrderRecord {
  id: string;
  userId: string;
  orderHash?: string | null;
  randomNumber: string;
  secretHash: string;
  sourceChain: string;
  destinationChain: string;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationAmount?: string | null;
  currentPhase: OrderPhase;
  relayerUrl: string;
  isCompleted: boolean;
  isSuccessful?: boolean | null;
  errorMessage?: string | null;
  secretRevealed: boolean;
  secretRevealedAt?: Date | null;
  orderData?: any;
  signedOrderData?: any;
  statusHistory: StatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface StatusHistoryEntry {
  phase: string;
  timestamp: number;
  data?: any;
}

// Supported chains
export type SupportedEVMChain = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'arbitrum';
export type SupportedNEARChain = 'near' | 'near-testnet';
export type SupportedChain = SupportedEVMChain | SupportedNEARChain;

// Error types
export interface CrossChainSwapError {
  code: 'PREPARATION_FAILED' | 'SIGNING_FAILED' | 'SUBMISSION_FAILED' | 
        'POLLING_TIMEOUT' | 'SECRET_REVEAL_FAILED' | 'RELAYER_ERROR' | 
        'ESCROW_VERIFICATION_FAILED' | 'UNKNOWN_ERROR';
  message: string;
  details?: any;
  phase?: OrderPhase;
}

// Configuration
export interface RelayerConfig {
  baseUrl: string;
  timeout: number;
  pollingInterval: number;
  maxPollingDuration: number;
}

export const DEFAULT_RELAYER_CONFIG: RelayerConfig = {
  baseUrl: 'https://1prime-relayer.up.railway.app/api/v1',
  timeout: 30000, // 30 seconds
  pollingInterval: 2000, // 2 seconds
  maxPollingDuration: 300000, // 5 minutes (Cloudflare Worker limit)
};

// Generic database type for cross-platform compatibility
export type CrossChainDatabase = any;