export interface ChainConfig {
  chainId: string;
  name: string;
  type: "evm" | "near";
  rpcUrl: string;
  blockTime: number; // Average block time in seconds
  finalityBlocks: number; // Blocks to wait for finality
  gasLimit: {
    withdrawal: number;
    cancellation: number;
  };
  // Cross-chain escrow factory addresses for 1inch Fusion+
  escrowFactoryAddress?: string;
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

  initialRateBump: number; // Basis points
  signature: string;
  nonce: string;
  createdAt: number;
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
  phase:
    | "announcement"
    | "deposit"
    | "withdrawal"
    | "waiting-for-secret"
    | "recovery"
    | "submitted" // Order signed and waiting for resolver pickup
    | "claimed" // Resolver has claimed the order
    | "src_escrow_deployed" // Source chain escrow deployed
    | "dst_escrow_deployed" // Destination chain escrow deployed
    | "completed"; // Both escrows deployed and confirmed
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

  secret?: SecretManagement;
  timelock?: TimelockPhase;
  isCompleted: boolean;
  error?: string;
  events: OrderEvent[];
}

export interface OrderEvent {
  type:
    | "order_created"
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
  verifyEscrow(
    orderHash: string,
    escrowAddress: string
  ): Promise<EscrowDetails>;
  withdrawFromEscrow(
    orderHash: string,
    secret: string,
    escrowAddress: string
  ): Promise<string>;
  cancelEscrow(orderHash: string, escrowAddress: string): Promise<string>;
  getBlockNumber(): Promise<number>;
  getTransaction(hash: string): Promise<any>;
  estimateGas(
    operation: string,
    params: any,
    escrowAddress?: string
  ): Promise<number>;
}

export interface RelayerConfig {
  port: number;
  environment: "development" | "staging" | "production";
  chains: Record<string, ChainConfig>;
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file?: string;
  };
  security: {
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

export interface GenerateOrderRequest {
  userAddress: string;
  amount: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  secretHash: string; // Previously generated secret hash from frontend
}

export interface SubmitSignedOrderRequest {
  orderHash: string;
  signature: string;
}

export interface ClaimOrderRequest {
  orderHash: string;
  resolverAddress: string;
}

export interface EscrowDeploymentConfirmation {
  orderHash: string;
  escrowType: "src" | "dst";
  escrowAddress: string;
  transactionHash: string;
  blockNumber: number;
  resolverAddress: string;
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

// SDK CrossChainOrder structure (incoming format)
export interface SDKAddress {
  val: string;
}

export interface SDKTimeLocks {
  srcWithdrawal: bigint; // A1: Finality lock period (source)
  srcPublicWithdrawal: bigint; // A2→A3: Resolver exclusive → Public access (source)
  srcCancellation: bigint; // A4: Resolver cancellation period (source)
  srcPublicCancellation: bigint; // A5: Public cancellation period (source)
  dstWithdrawal: bigint; // B1: Finality lock period (destination)
  dstPublicWithdrawal: bigint; // B2→B3: Resolver exclusive → Public access (destination)
  dstCancellation: bigint; // B4: Resolver cancellation period (destination)
}

export interface SDKHashLock {
  // Hash lock structure from SDK
  [key: string]: any;
  // For single fills
  secretHash?: string;
  secret?: string;
  // For multiple fills (Merkle tree)
  merkleRoot?: string;
  merkleLeaves?: string[];
  secretHashes?: string[];
  secrets?: string[];
}

export interface SDKEscrowExtension {
  address: SDKAddress;
  postInteractionData: any;
  makerPermit?: string;
  builder: any;
  hashLockInfo: SDKHashLock;
  dstChainId: number;
  dstToken: SDKAddress;
  srcSafetyDeposit: bigint;
  dstSafetyDeposit: bigint;
  timeLocks: SDKTimeLocks;
}

export interface SDKLimitOrder {
  extension: any;
  makerAsset: SDKAddress;
  takerAsset: SDKAddress;
  makingAmount: bigint;
  takingAmount: bigint;
  _salt: bigint;
  maker: SDKAddress;
  receiver: SDKAddress;
  makerTraits: any;
}

export interface SDKInnerOrder {
  settlementExtensionContract: SDKAddress;
  inner: SDKLimitOrder;
  fusionExtension: SDKEscrowExtension;
  escrowExtension: SDKEscrowExtension;
}

export interface SDKCrossChainOrder {
  inner: SDKInnerOrder;
}

// Extend existing FusionOrder with SDK-extracted fields
export interface FusionOrderExtended extends FusionOrder {
  // SDK-extracted fields
  receiver?: string; // From SDK: receiver address (if different from maker)
  srcSafetyDeposit?: string; // From SDK: srcSafetyDeposit
  dstSafetyDeposit?: string; // From SDK: dstSafetyDeposit

  // Multiple fills support (Merkle tree secrets)
  allowPartialFills?: boolean; // From SDK: allowPartialFills
  allowMultipleFills?: boolean; // From SDK: allowMultipleFills
  merkleSecretTree?: {
    merkleRoot: string; // Root of the Merkle tree
    merkleLeaves: string[]; // All secret hashes in the tree
    secretCount: number; // N+1 secrets (N parts + 1 completion)
    fillParts: number; // How many parts the order is divided into
  };

  // Detailed timelock phases from SDK timeLocks
  detailedTimeLocks?: {
    srcWithdrawal: number; // A1: Finality lock (source)
    srcPublicWithdrawal: number; // A2→A3: Resolver → Public (source)
    srcCancellation: number; // A4: Resolver cancellation (source)
    srcPublicCancellation: number; // A5: Public cancellation (source)
    dstWithdrawal: number; // B1: Finality lock (destination)
    dstPublicWithdrawal: number; // B2→B3: Resolver → Public (destination)
    dstCancellation: number; // B4: Resolver cancellation (destination)
  };

  // Order state management
  phase?: string; // Current order phase (submitted, claimed, src_escrow_deployed, etc.)
  assignedResolver?: string; // Resolver assigned to this order
  estimatedGas?: number; // Gas estimate for execution

  // Escrow contract addresses
  srcEscrowAddress?: string; // Source chain escrow contract address
  dstEscrowAddress?: string; // Destination chain escrow contract address
  srcEscrowTxHash?: string; // Source escrow deployment transaction hash
  dstEscrowTxHash?: string; // Destination escrow deployment transaction hash
  srcEscrowBlockNumber?: number; // Source escrow deployment block number
  dstEscrowBlockNumber?: number; // Destination escrow deployment block number

  // Deployment timestamps (CRITICAL for timelock calculation)
  sourceEscrowDeployedAt?: number; // When source escrow deployed (E1)
  destinationEscrowDeployedAt?: number; // When destination escrow deployed (E2)
}

// Timelock phase info (calculated from deployment time + timeLocks)
export interface TimelockPhaseInfo {
  orderHash: string;

  // Source chain phases (A1-A5)
  sourcePhases: {
    A1_finalityLock: { start: number; end: number; isActive: boolean };
    A2_resolverUnlock: { start: number; end: number; isActive: boolean };
    A3_publicUnlock: { start: number; end: number; isActive: boolean };
    A4_resolverCancellation: { start: number; end: number; isActive: boolean };
    A5_publicCancellation: { start: number; end: number; isActive: boolean };
  };

  // Destination chain phases (B1-B4)
  destinationPhases: {
    B1_finalityLock: { start: number; end: number; isActive: boolean };
    B2_resolverUnlock: { start: number; end: number; isActive: boolean };
    B3_publicUnlock: { start: number; end: number; isActive: boolean };
    B4_resolverCancellation: { start: number; end: number; isActive: boolean };
  };

  currentSourcePhase: "A1" | "A2" | "A3" | "A4" | "A5" | "expired";
  currentDestinationPhase: "B1" | "B2" | "B3" | "B4" | "expired";
}
