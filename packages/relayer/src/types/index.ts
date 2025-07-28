export interface ChainConfig {
  chainId: string;
  name: string;
  type: "evm" | "near";
  rpcUrl: string;
  contractAddresses: {
    htlc: string;
  };
  blockTime: number; // Average block time in seconds
  finalityBlocks: number; // Blocks to wait for finality
  gasLimit: {
    htlcCreation: number;
    withdrawal: number;
    cancellation: number;
  };
}

export interface FusionOrder {
  orderHash: string;
  maker: string;
  sourceChain: string;
  destinationChain: string;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationAmount: string;
  secretHash: string;
  timeout: number;
  auctionStartTime: number;
  auctionDuration: number;
  initialRateBump: number; // Basis points
  signature: string;
  nonce: string;
  createdAt: number;
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
  createdAt?: number;
  withdrawnAt?: number;
  cancelledAt?: number;
  transactionHash?: string;
}

export interface SecretManagement {
  orderHash: string;
  secret: string;
  secretHash: string;
  isRevealed: boolean;
  revealedAt?: number;
  revealedBy?: string;
  merkleTree?: MerkleSecretTree;
}

export interface MerkleSecretTree {
  orderHash: string;
  totalParts: number;
  secrets: string[];
  merkleRoot: string;
  partialFills: PartialFill[];
}

export interface PartialFill {
  fillIndex: number;
  fillPercentage: number;
  secretUsed: string;
  resolver: string;
  timestamp: number;
}

export interface TimelockPhase {
  phase: "announcement" | "deposit" | "withdrawal" | "recovery";
  orderHash: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  nextPhase?: string;
}

export interface RelayerStatus {
  address: string;
  isKyc: boolean;
  reputation: number;
  completedOrders: number;
  lastActivity: number;
}

export interface OrderStatus {
  orderHash: string;
  phase: TimelockPhase["phase"];
  sourceEscrow?: EscrowDetails;
  destinationEscrow?: EscrowDetails;
  auction?: DutchAuctionState;
  secret?: SecretManagement;
  timelock?: TimelockPhase;
  isCompleted: boolean;
  error?: string;
  events: OrderEvent[];
}

export interface OrderEvent {
  type:
    | "order_created"
    | "auction_started"
    | "escrow_created"
    | "secret_revealed"
    | "withdrawal_completed"
    | "order_cancelled"
    | "error";
  timestamp: number;
  data: any;
  transactionHash?: string;
  blockNumber?: number;
}

export interface ChainAdapter {
  getBalance(address: string, token?: string): Promise<string>;
  checkContractDeployment(address: string): Promise<boolean>;
  createEscrow(order: FusionOrder, resolver: string): Promise<string>;
  verifyEscrow(orderHash: string): Promise<EscrowDetails>;
  withdrawFromEscrow(orderHash: string, secret: string): Promise<string>;
  cancelEscrow(orderHash: string): Promise<string>;
  getBlockNumber(): Promise<number>;
  getTransaction(hash: string): Promise<any>;
  estimateGas(operation: string, params: any): Promise<number>;
}

export interface RelayerConfig {
  port: number;
  environment: "development" | "staging" | "production";
  chains: Record<string, ChainConfig>;
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file?: string;
  };
  security: {
    enableRateLimit: boolean;
    maxRequestsPerMinute: number;
    corsOrigins: string[];
  };
  database: {
    supabaseUrl: string;
    supabaseKey: string;
  };
  monitoring: {
    healthCheckInterval: number;
    escrowCheckInterval: number;
    timelockCheckInterval: number;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string | undefined;
  timestamp: number;
}

export interface CreateOrderRequest {
  sourceChain: string;
  destinationChain: string;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationAmount: string;
  timeout: number;
  auctionDuration?: number;
  initialRateBump?: number;
  signature: string;
  nonce: string;
}

export interface ResolverBidRequest {
  orderHash: string;
  resolver: string;
  estimatedGas: number;
  signature: string;
}

export interface SecretRevealRequest {
  orderHash: string;
  secret: string;
  proof: string;
  signature: string;
}

export interface HealthCheckResponse {
  status: "healthy" | "unhealthy";
  timestamp: number;
  version: string;
  chains: Record<
    string,
    {
      connected: boolean;
      blockNumber: number;
      latency: number;
    }
  >;
  activeOrders: number;
  completedOrders: number;
  errorRate: number;
}
