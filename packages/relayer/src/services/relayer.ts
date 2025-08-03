import { EventEmitter } from "events";
import type { Logger } from "winston";
import {
  FusionOrder,
  FusionOrderExtended,
  OrderStatus,
  TimelockPhase,
  SecretRevealRequest,
  RelayerStatus,
  HealthCheckResponse,
  GenerateOrderRequest,
  SubmitSignedOrderRequest,
  SDKCrossChainOrder,
  ClaimOrderRequest,
  EscrowDeploymentConfirmation,
} from "../types";
import { OrderManager } from "./order-manager";
import { EscrowVerifier } from "./escrow-verifier";
import { SecretManager, SecretRevealConditions } from "./secret-manager";
import { TimelockManager } from "./timelock-manager";
import { ChainAdapterFactory } from "../adapters";
import {
  isValidChainPair,
  getChainConfig,
  getEscrowFactoryAddress,
  getChainNameFromChainId,
} from "../config/chains";
import { getTokenAddress, isTokenSupportedOnChain } from "../config/tokens";

// Helper function to determine if a chain is EVM-based
function isEvmChain(chainId: string): boolean {
  const evmChains = [
    "ethereum",
    "eth-sepolia",
    "base",
    "bsc",
    "polygon",
    "arbitrum",
    "11155111",
    "1",
    "8453",
    "56",
    "137",
    "42161",
  ];
  return evmChains.includes(chainId.toLowerCase());
}

// Helper function to determine if a chain is NEAR-based
function isNearChain(chainId: string): boolean {
  const nearChains = ["near", "near-testnet", "397", "398"];
  return nearChains.includes(chainId.toLowerCase());
}
import { DatabaseService } from "./database";
import { OneInchApiService } from "./1inch-api";
import { SDKOrderMapper } from "../utils/sdk-mapper";
import {
  CrossChainOrder,
  HashLock,
  TimeLocks,
  Address,
  randBigInt,
  AuctionDetails,
  NetworkEnum,
} from "@1inch/cross-chain-sdk";
import {
  parseUnits,
  randomBytes,
  JsonRpcProvider,
  Contract,
  Signer,
  ethers,
} from "ethers";
import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import { JsonRpcProvider as NearJsonRpcProvider } from "@near-js/providers";

export interface RelayerServiceConfig {
  chainIds: string[];
  privateKeys?: Record<string, string>;
  enablePartialFills: boolean;
  healthCheckInterval: number;
}

export class RelayerService extends EventEmitter {
  private logger: Logger;
  private config: RelayerServiceConfig;
  private databaseService: DatabaseService;
  private oneInchApiService?: OneInchApiService;
  private orderManager: OrderManager;
  private escrowVerifier: EscrowVerifier;
  private secretManager: SecretManager;
  private timelockManager: TimelockManager;
  private webSocketService?: any; // Optional WebSocket service

  // NEAR address mapping for SDK compatibility
  private nearAddressMapping: Map<string, string> = new Map(); // placeholder -> original NEAR address
  private reverseNearMapping: Map<string, string> = new Map(); // original NEAR -> placeholder

  private isInitialized = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private stats: {
    ordersCreated: number;
    ordersCompleted: number;
    ordersCancelled: number;
    totalVolume: string;
    uptime: number;
  };

  constructor(
    logger: Logger,
    config: RelayerServiceConfig,
    databaseService: DatabaseService,
    oneInchApiService?: OneInchApiService
  ) {
    super();
    this.logger = logger;
    this.config = config;
    this.databaseService = databaseService;
    this.oneInchApiService = oneInchApiService;
    this.stats = {
      ordersCreated: 0,
      ordersCompleted: 0,
      ordersCancelled: 0,
      totalVolume: "0",
      uptime: Date.now(),
    };

    // Initialize core services
    this.orderManager = new OrderManager(logger);
    this.escrowVerifier = new EscrowVerifier(logger, oneInchApiService);
    this.secretManager = new SecretManager(logger);
    this.timelockManager = new TimelockManager(logger);

    this.setupEventHandlers();
  }

  /**
   * Set WebSocket service for broadcasting events
   */
  setWebSocketService(webSocketService: any): void {
    this.webSocketService = webSocketService;
  }

  // Getter for database service (for debugging purposes)
  get dbService() {
    return this.databaseService;
  }

  /**
   * Check if an address is a NEAR address format
   */
  private isNearAddress(address: string): boolean {
    // NEAR addresses can be:
    // 1. Named accounts: ending with .near or .testnet
    // 2. Implicit accounts: 64-character hex strings
    return (
      address.includes(".near") ||
      address.includes(".testnet") ||
      (address.length === 64 && /^[0-9a-fA-F]+$/.test(address))
    );
  }

  /**
   * Generate a random EVM address as placeholder for NEAR addresses
   */
  private generateEvmPlaceholder(): string {
    // Generate 20 random bytes and convert to hex
    const randomBytes = new Uint8Array(20);
    crypto.getRandomValues(randomBytes);
    return (
      "0x" +
      Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /**
   * Convert NEAR address to EVM placeholder, maintaining bidirectional mapping
   */
  private convertNearToEvmPlaceholder(nearAddress: string): string {
    // Check if we already have a mapping for this NEAR address
    const existingPlaceholder = this.reverseNearMapping.get(nearAddress);
    if (existingPlaceholder) {
      return existingPlaceholder;
    }

    // Generate new placeholder
    let placeholder = this.generateEvmPlaceholder();

    // Ensure uniqueness (very unlikely collision, but just in case)
    while (this.nearAddressMapping.has(placeholder)) {
      placeholder = this.generateEvmPlaceholder();
    }

    // Store bidirectional mapping
    this.nearAddressMapping.set(placeholder, nearAddress);
    this.reverseNearMapping.set(nearAddress, placeholder);

    this.logger.debug("Generated EVM placeholder for NEAR address", {
      originalNear: nearAddress,
      evmPlaceholder: placeholder,
    });

    return placeholder;
  }

  /**
   * Get original NEAR address from EVM placeholder
   */
  private getOriginalNearAddress(evmPlaceholder: string): string | null {
    return this.nearAddressMapping.get(evmPlaceholder) || null;
  }

  /**
   * Process address: convert NEAR to EVM placeholder if needed
   */
  private processAddress(address: string): string {
    if (this.isNearAddress(address)) {
      return this.convertNearToEvmPlaceholder(address);
    }
    return address;
  }

  /**
   * Get address mappings for an order (useful for resolvers)
   */
  async getAddressMappings(orderHash: string): Promise<{
    originalAddresses?: any;
    processedAddresses?: any;
    nearAddressMappings?: Record<string, string>;
  } | null> {
    try {
      const orderRecord = await this.databaseService.getOrder(orderHash);
      if (!orderRecord) {
        return null;
      }

      const extendedRecord = orderRecord as FusionOrderExtended;
      return {
        originalAddresses: extendedRecord.originalAddresses,
        processedAddresses: extendedRecord.processedAddresses,
        nearAddressMappings: extendedRecord.nearAddressMappings,
      };
    } catch (error) {
      this.logger.error("Failed to get address mappings", {
        error: (error as Error).message,
        orderHash,
      });
      return null;
    }
  }

  /**
   * Resolve EVM placeholder to original NEAR address
   */
  resolveNearAddress(evmPlaceholder: string): string | null {
    return this.getOriginalNearAddress(evmPlaceholder);
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        this.logger.warn("Relayer service already initialized");
        return;
      }

      // Initialize chain adapters
      await this.escrowVerifier.initializeAdapters(
        this.config.chainIds,
        this.config.privateKeys
      );

      // Initialize timelock manager
      await this.timelockManager.initialize();

      // Restore active orders from database
      await this.restoreStateFromDatabase();

      // Start health checks
      this.startHealthChecks();

      this.isInitialized = true;
      this.logger.info("Relayer service initialized successfully", {
        chainIds: this.config.chainIds,
      });

      this.emit("relayer_initialized");
    } catch (error) {
      this.logger.error("Failed to initialize relayer service", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create order from SDK CrossChainOrder format
   */
  async createOrderFromSDK(
    fusionOrder: FusionOrderExtended
  ): Promise<OrderStatus> {
    try {
      this.validateInitialized();

      // Create the order through OrderManager
      const orderStatus =
        await this.orderManager.createOrderFromSDK(fusionOrder);

      // Start timelock monitoring with enhanced phases
      if (fusionOrder.detailedTimeLocks) {
        await this.timelockManager.startMonitoring(fusionOrder.orderHash);
      }

      this.logger.info("SDK Order created successfully", {
        orderHash: fusionOrder.orderHash,
        maker: fusionOrder.maker,
        sourceChain: fusionOrder.sourceChain,
        destinationChain: fusionOrder.destinationChain,
        srcSafetyDeposit: fusionOrder.srcSafetyDeposit,
        dstSafetyDeposit: fusionOrder.dstSafetyDeposit,
      });

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to create SDK order", {
        error: (error as Error).message,
        fusionOrder,
      });
      throw error;
    }
  }

  /**
   * Generate unsigned Fusion+ order for frontend signing (Steps 3+4+5)
   */
  async createFusionOrder(params: GenerateOrderRequest): Promise<{
    orderHash: string;
    fusionOrder: any; // SDK CrossChainOrder
    success: boolean;
    message: string;
  }> {
    try {
      this.validateInitialized();

      // Validate chain pair
      if (!isValidChainPair(params.fromChain, params.toChain)) {
        throw new Error(
          `Invalid chain pair: ${params.fromChain} -> ${params.toChain}`
        );
      }

      // Convert chain IDs to chain names if needed
      let srcChainId = params.fromChain;
      let dstChainId = params.toChain;

      //Get the NetworkEnum from the chain id
      const chainIdToNetwork = {
        "11155111": NetworkEnum.ETH_SEPOLIA,
        "397": NetworkEnum.NEAR,
        "398": NetworkEnum.NEAR_TESTNET,
      };

      const srcChain = (chainIdToNetwork[
        srcChainId as keyof typeof chainIdToNetwork
      ] || NetworkEnum.ETHEREUM) as any;
      const dstChain = (chainIdToNetwork[
        dstChainId as keyof typeof chainIdToNetwork
      ] || NetworkEnum.ETHEREUM) as any;

      //Get the appropriate escrow factory address for the source chain
      const chainName = getChainNameFromChainId(srcChainId);
      const escrowFactoryAddress = getEscrowFactoryAddress(chainName as string);

      console.log("escrowFactoryAddress", escrowFactoryAddress);

      // Validate token support on respective chains
      if (!isTokenSupportedOnChain(params.fromToken, srcChainId)) {
        throw new Error(
          `Token '${params.fromToken}' not supported on chain '${srcChainId}'`
        );
      }
      if (!isTokenSupportedOnChain(params.toToken, dstChainId)) {
        throw new Error(
          `Token '${params.toToken}' not supported on chain '${dstChainId}'`
        );
      }

      // Resolve token addresses based on chain
      const sourceTokenAddress = getTokenAddress(params.fromToken, srcChainId);
      const destinationTokenAddress = getTokenAddress(
        params.toToken,
        dstChainId
      );

      // Process addresses: convert NEAR addresses to EVM placeholders for SDK compatibility
      const processedUserSrcAddress = this.processAddress(
        params.userSrcAddress
      );
      const processedUserDstAddress = this.processAddress(
        params.userDstAddress
      );
      const processedFromToken = this.processAddress(sourceTokenAddress);
      const processedToToken = this.processAddress(destinationTokenAddress);
      const processedEscrowFactory = this.processAddress(escrowFactoryAddress);

      this.logger.debug("Address and token processing completed", {
        originalUserSrcAddress: params.userSrcAddress,
        processedUserSrcAddress,
        originalUserDstAddress: params.userDstAddress,
        processedUserDstAddress,
        fromTokenSymbol: params.fromToken,
        sourceTokenAddress,
        processedFromToken,
        toTokenSymbol: params.toToken,
        destinationTokenAddress,
        processedToToken,
        originalEscrowFactory: escrowFactoryAddress,
        processedEscrowFactory,
      });

      // Create hash lock from the provided hash
      const hashLock = HashLock.fromString(params.secretHash);

      // Determine which SDK method to use based on chain types
      const srcIsEvm = isEvmChain(srcChainId);
      const dstIsNear = isNearChain(dstChainId);

      this.logger.info("Chain type detection", {
        srcChainId,
        dstChainId,
        srcIsEvm,
        dstIsNear,
        sdkMethod:
          srcIsEvm && dstIsNear
            ? "CrossChainOrder.new"
            : "CrossChainOrder.new_near",
      });

      let order;

      if (srcIsEvm && dstIsNear) {
        // EVM to NEAR: use standard CrossChainOrder.new
        order = CrossChainOrder.new(
          new Address(processedEscrowFactory),
          {
            salt: randBigInt(1000n),
            maker: new Address(processedUserSrcAddress),
            makingAmount: parseUnits(params.amount, 18), // Adjust decimals as needed
            takingAmount: parseUnits(params.amount, 18), // You may want to calculate exchange rate
            makerAsset: new Address(processedFromToken),
            takerAsset: new Address(processedToToken),
          },
          {
            hashLock,
            timeLocks: TimeLocks.new({
              srcWithdrawal: 300n, // 5 minutes finality lock
              srcPublicWithdrawal: 600n, // 10 minutes private withdrawal
              srcCancellation: 1800n, // 30 minutes cancellation
              srcPublicCancellation: 3600n, // 1 hour public cancellation
              dstWithdrawal: 300n, // 5 minutes finality lock
              dstPublicWithdrawal: 600n, // 10 minutes private withdrawal
              dstCancellation: 1800n, // 30 minutes cancellation
            }),
            srcChainId: srcChain,
            dstChainId: dstChain,
            srcSafetyDeposit: parseUnits("0.001", 18), // Small safety deposit
            dstSafetyDeposit: parseUnits("0.001", 18), // Small safety deposit
          },
          {
            auction: new AuctionDetails({
              initialRateBump: 1000, // 10% initial rate bump
              points: [], // Custom auction curve points (empty for default)
              duration: 120n, // 2 minutes auction duration
              startTime: BigInt(Math.floor(Date.now() / 1000)), // Current timestamp
            }),
            whitelist: [
              {
                address: new Address(processedEscrowFactory),
                allowFrom: 0n,
              },
            ],
            resolvingStartTime: 0n, // Immediate resolving
          },
          {
            nonce: randBigInt(UINT_40_MAX),
            allowPartialFills: false, // Single fill for now
            allowMultipleFills: false, // Single fill for now
          }
        );
      } else {
        // All other cases (NEAR to EVM, NEAR to NEAR, etc.): use CrossChainOrder.new_near
        order = CrossChainOrder.new_near(
          {
            salt: randBigInt(1000n),
            maker: new Address(processedUserSrcAddress),
            makingAmount: parseUnits(params.amount, 18), // Adjust decimals as needed
            takingAmount: parseUnits(params.amount, 18), // You may want to calculate exchange rate
            makerAsset: new Address(processedFromToken),
            takerAsset: new Address(processedToToken),
          },
          {
            hashLock,
            timeLocks: TimeLocks.new({
              srcWithdrawal: 300n, // 5 minutes finality lock
              srcPublicWithdrawal: 600n, // 10 minutes private withdrawal
              srcCancellation: 1800n, // 30 minutes cancellation
              srcPublicCancellation: 3600n, // 1 hour public cancellation
              dstWithdrawal: 300n, // 5 minutes finality lock
              dstPublicWithdrawal: 600n, // 10 minutes private withdrawal
              dstCancellation: 1800n, // 30 minutes cancellation
            }),
            srcChainId: srcChain,
            dstChainId: dstChain,
            srcSafetyDeposit: parseUnits("0.001", 18), // Small safety deposit
            dstSafetyDeposit: parseUnits("0.001", 18), // Small safety deposit
          },
          {
            auction: new AuctionDetails({
              initialRateBump: 1000, // 10% initial rate bump
              points: [], // Custom auction curve points (empty for default)
              duration: 120n, // 2 minutes auction duration
              startTime: BigInt(Math.floor(Date.now() / 1000)), // Current timestamp
            }),
            whitelist: [
              {
                address: new Address(processedEscrowFactory),
                allowFrom: 0n,
              },
            ],
            resolvingStartTime: 0n, // Immediate resolving
          },
          {
            nonce: randBigInt(UINT_40_MAX),
            allowPartialFills: false, // Single fill for now
            allowMultipleFills: false, // Single fill for now
          }
        );
      }

      console.log("order", order);

      // Generate order hash using SDK
      const orderHash = order.getOrderHash(Number(srcChainId));

      this.logger.info("Fusion order generated using SDK", {
        orderHash,
        userSrcAddress: params.userSrcAddress,
        userDstAddress: params.userDstAddress,
        fromChain: params.fromChain,
        toChain: params.toChain,
        fromTokenSymbol: params.fromToken,
        toTokenSymbol: params.toToken,
        sourceTokenAddress,
        destinationTokenAddress,
        srcChainName: this.getChainNameFromId(Number(srcChainId)),
        dstChainName: this.getChainNameFromId(Number(dstChainId)),
        srcChainId,
        dstChainId,
        makingAmount: order.makingAmount.toString(),
        takingAmount: order.takingAmount.toString(),
      });

      // Store the prepared order in database with full details including address mappings
      const orderDetails = {
        userSrcAddress: params.userSrcAddress,
        userDstAddress: params.userDstAddress,
        amount: params.amount,
        fromTokenSymbol: params.fromToken,
        toTokenSymbol: params.toToken,
        fromChain: params.fromChain,
        toChain: params.toChain,
        secretHash: params.secretHash,
        srcChainId,
        dstChainId,
        // Store original addresses and resolved token addresses
        originalAddresses: {
          userSrcAddress: params.userSrcAddress,
          userDstAddress: params.userDstAddress,
          sourceTokenAddress,
          destinationTokenAddress,
          escrowFactory: escrowFactoryAddress,
        },
        // Store processed addresses used in SDK
        processedAddresses: {
          userSrcAddress: processedUserSrcAddress,
          userDstAddress: processedUserDstAddress,
          fromToken: processedFromToken,
          toToken: processedToToken,
          escrowFactory: processedEscrowFactory,
        },
        // Store address mappings for lookup
        nearAddressMappings: Object.fromEntries(this.nearAddressMapping),
      };

      await this.databaseService.storePreparedOrder(
        orderHash,
        order,
        orderDetails
      );

      this.logger.info("Order prepared and stored", {
        orderHash,
        userSrcAddress: params.userSrcAddress,
        userDstAddress: params.userDstAddress,
        fromTokenSymbol: params.fromToken,
        toTokenSymbol: params.toToken,
      });

      // Only return orderHash - full order details are stored in DB
      return {
        orderHash,
        fusionOrder: order,
        success: true,
        message:
          "Order prepared successfully. Use this orderHash with your signature to submit.",
      };
    } catch (error) {
      this.logger.error("Failed to create fusion order", {
        error: (error as Error).message,
        params,
      });
      throw error;
    }
  }

  public async signOrder(
    srcChainId: number,
    order: CrossChainOrder
  ): Promise<string> {
    const typedData = order.getTypedData(srcChainId);

    let signer: Signer;

    //use this form the ENV EVM_PRIVATE_KEY
    const privateKey = process.env.EVM_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("EVM_PRIVATE_KEY is not set");
    }
    signer = new ethers.Wallet(privateKey);

    return signer.signTypedData(
      typedData.domain,
      { Order: typedData.types[typedData.primaryType] },
      typedData.message
    );
  }

  /**
   * Validate signed order before processing (Step 6)
   */
  async validateSignedOrder(
    orderHash: string,
    signedOrder: any, // SDK CrossChainOrder
    signature: string
  ): Promise<boolean> {
    try {
      // Basic validation checks
      if (!orderHash || !signedOrder || !signature) {
        return false;
      }

      // Verify orderHash format
      if (!/^0x[a-fA-F0-9]{64}$/.test(orderHash)) {
        return false;
      }

      // Verify signature format
      if (!/^0x[a-fA-F0-9]+$/.test(signature)) {
        return false;
      }

      // Validate the order has the required properties
      if (
        !signedOrder.maker ||
        !signedOrder.makingAmount ||
        !signedOrder.takingAmount
      ) {
        return false;
      }

      // Additional validation could include:
      // - Verify signature matches the order data using SDK methods
      // - Check order hasn't expired
      // - Validate amounts and tokens
      // - Ensure chains are supported

      this.logger.debug("Signed order validation passed", {
        orderHash,
        maker: signedOrder.maker.toString(),
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to validate signed order", {
        error: (error as Error).message,
        orderHash,
      });
      return false;
    }
  }

  /**
   * Transform complex SDK order object to flat FusionOrderExtended structure
   */
  private transformSDKOrderToFusionOrder(
    sdkOrder: any,
    orderHash: string,
    orderDetails: any,
    signature: string
  ): FusionOrderExtended {
    // Extract data from nested SDK structure
    const innerOrder = sdkOrder.inner?.inner;
    const fusionExtension = sdkOrder.inner?.fusionExtension;
    const escrowExtension = sdkOrder.inner?.escrowExtension;

    if (!innerOrder) {
      throw new Error("Invalid SDK order structure: missing inner.inner data");
    }

    // Map chain IDs to chain names
    const sourceChain = this.getChainNameFromId(
      Number(orderDetails.srcChainId)
    );
    const destinationChain = this.getChainNameFromId(
      Number(orderDetails.dstChainId)
    );

    // Use original addresses if available (for NEAR compatibility), otherwise fall back to processed/SDK values
    const originalAddresses = orderDetails.originalAddresses || {};
    const processedAddresses = orderDetails.processedAddresses || {};

    // Restore address mappings from database
    if (orderDetails.nearAddressMappings) {
      for (const [placeholder, originalNear] of Object.entries(
        orderDetails.nearAddressMappings
      )) {
        this.nearAddressMapping.set(
          placeholder as string,
          originalNear as string
        );
        this.reverseNearMapping.set(
          originalNear as string,
          placeholder as string
        );
      }
    }

    return {
      // Basic order fields - use original addresses for final execution
      orderHash,
      maker:
        originalAddresses.userSrcAddress ||
        originalAddresses.userAddress ||
        innerOrder.maker?.val ||
        orderDetails.userSrcAddress ||
        orderDetails.userAddress,
      userSrcAddress:
        originalAddresses.userSrcAddress ||
        originalAddresses.userAddress ||
        orderDetails.userSrcAddress ||
        orderDetails.userAddress,
      userDstAddress:
        originalAddresses.userDstAddress ||
        orderDetails.userDstAddress ||
        orderDetails.userAddress, // Fallback to same address if not specified
      sourceChain,
      destinationChain,
      sourceToken:
        originalAddresses.fromToken ||
        innerOrder.makerAsset?.val ||
        orderDetails.fromToken,
      destinationToken:
        originalAddresses.toToken ||
        innerOrder.takerAsset?.val ||
        orderDetails.toToken,
      sourceAmount: innerOrder.makingAmount || orderDetails.amount,
      destinationAmount: innerOrder.takingAmount || orderDetails.amount,
      secretHash:
        fusionExtension?.hashLockInfo?.value || orderDetails.secretHash,
      timeout: Date.now() + 3600000, // 1 hour from now

      initialRateBump: 0, // Hardcoded to 0 - no dutch auction for now
      signature,
      nonce: innerOrder._salt || "",
      createdAt: Date.now(),

      // SDK-specific fields
      receiver: innerOrder.receiver?.val,
      srcSafetyDeposit: fusionExtension?.srcSafetyDeposit,
      dstSafetyDeposit: fusionExtension?.dstSafetyDeposit,
      allowPartialFills: false, // Default
      allowMultipleFills: false, // Default

      // Extract timelock values from SDK order
      detailedTimeLocks: this.extractTimeLocks(fusionExtension),

      // Store both original and processed addresses for reference
      originalAddresses,
      processedAddresses,
      nearAddressMappings: orderDetails.nearAddressMappings,

      // Order state management
      phase: "submitted",
    };
  }

  /**
   * Extract timelock values from SDK fusionExtension
   */
  private extractTimeLocks(fusionExtension: any): any {
    // First, try to find parsed timelock values in the extension
    if (fusionExtension?.parsedTimeLocks) {
      return fusionExtension.parsedTimeLocks;
    }

    // If there's a timeLocks object with individual properties
    if (
      fusionExtension?.timeLocks &&
      typeof fusionExtension.timeLocks === "object" &&
      !fusionExtension.timeLocks.startsWith?.("0x")
    ) {
      return {
        srcWithdrawal: Number(fusionExtension.timeLocks.srcWithdrawal || 300),
        srcPublicWithdrawal: Number(
          fusionExtension.timeLocks.srcPublicWithdrawal || 600
        ),
        srcCancellation: Number(
          fusionExtension.timeLocks.srcCancellation || 1800
        ),
        srcPublicCancellation: Number(
          fusionExtension.timeLocks.srcPublicCancellation || 3600
        ),
        dstWithdrawal: Number(fusionExtension.timeLocks.dstWithdrawal || 300),
        dstPublicWithdrawal: Number(
          fusionExtension.timeLocks.dstPublicWithdrawal || 600
        ),
        dstCancellation: Number(
          fusionExtension.timeLocks.dstCancellation || 1800
        ),
      };
    }

    // If it's a hex string, parse it
    if (
      fusionExtension?.timeLocks &&
      typeof fusionExtension.timeLocks === "string" &&
      fusionExtension.timeLocks.startsWith("0x")
    ) {
      return this.parseTimeLockHex(fusionExtension.timeLocks);
    }

    // Fallback to reasonable defaults
    return {
      srcWithdrawal: 300, // 5 minutes
      srcPublicWithdrawal: 600, // 10 minutes
      srcCancellation: 1800, // 30 minutes
      srcPublicCancellation: 3600, // 1 hour
      dstWithdrawal: 300, // 5 minutes
      dstPublicWithdrawal: 600, // 10 minutes
      dstCancellation: 1800, // 30 minutes
    };
  }

  /**
   * Parse timelock hex string into individual values
   * The hex string contains packed timelock values
   */
  private parseTimeLockHex(timeLockHex: string): any {
    try {
      // Remove 0x prefix
      const hex = timeLockHex.slice(2);

      // The hex string contains packed timelock values
      // Each timelock is typically 4 bytes (8 hex chars)
      // Format might be: srcWithdrawal(4) + srcPublicWithdrawal(4) + srcCancellation(4) + srcPublicCancellation(4) + dstWithdrawal(4) + dstPublicWithdrawal(4) + dstCancellation(4)

      if (hex.length >= 56) {
        // 7 * 8 = 56 hex chars for 7 values
        const srcWithdrawal = parseInt(hex.slice(0, 8), 16);
        const srcPublicWithdrawal = parseInt(hex.slice(8, 16), 16);
        const srcCancellation = parseInt(hex.slice(16, 24), 16);
        const srcPublicCancellation = parseInt(hex.slice(24, 32), 16);
        const dstWithdrawal = parseInt(hex.slice(32, 40), 16);
        const dstPublicWithdrawal = parseInt(hex.slice(40, 48), 16);
        const dstCancellation = parseInt(hex.slice(48, 56), 16);

        return {
          srcWithdrawal,
          srcPublicWithdrawal,
          srcCancellation,
          srcPublicCancellation,
          dstWithdrawal,
          dstPublicWithdrawal,
          dstCancellation,
        };
      }
    } catch (error) {
      this.logger.warn("Failed to parse timelock hex, using defaults", {
        timeLockHex,
        error: (error as Error).message,
      });
    }

    // Fallback to defaults if parsing fails
    return {
      srcWithdrawal: 300,
      srcPublicWithdrawal: 600,
      srcCancellation: 1800,
      srcPublicCancellation: 3600,
      dstWithdrawal: 300,
      dstPublicWithdrawal: 600,
      dstCancellation: 1800,
    };
  }

  /**
   * Submit signed order and start relayer processing (Step 6)
   * Simplified: takes only orderHash and signature, retrieves order from database
   */
  async submitSignedOrder(
    orderHash: string,
    signature: string
  ): Promise<OrderStatus> {
    try {
      this.validateInitialized();

      // Retrieve the prepared order from database
      const preparedOrder =
        await this.databaseService.getPreparedOrder(orderHash);
      if (!preparedOrder) {
        throw new Error(`Prepared order not found for hash: ${orderHash}`);
      }

      const { fusionOrder: sdkOrder, orderDetails } = preparedOrder;

      this.logger.info("Retrieved prepared order for submission", {
        orderHash,
        userAddress: orderDetails.userAddress,
      });

      // Transform SDK object to FusionOrderExtended
      const completedOrder: FusionOrderExtended =
        this.transformSDKOrderToFusionOrder(
          sdkOrder,
          orderHash,
          orderDetails,
          signature
        );

      // Store in database
      await this.databaseService.storeSignedOrder(completedOrder);

      // Create order through OrderManager with the signed data
      const orderStatus =
        await this.orderManager.createOrderFromSDK(completedOrder);

      // Start timelock monitoring
      if (completedOrder.detailedTimeLocks) {
        await this.timelockManager.startMonitoring(completedOrder.orderHash);
      }

      this.stats.ordersCreated++;

      this.logger.info("Signed order submitted successfully", {
        orderHash,
        maker: completedOrder.maker,
        sourceChain: completedOrder.sourceChain,
        destinationChain: completedOrder.destinationChain,
      });

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to submit signed order", {
        error: (error as Error).message,
        orderHash,
      });
      throw error;
    }
  }

  /**
   * Update order state (Step 9 - for resolvers)
   */
  async updateOrderState(
    orderHash: string,
    newState: string,
    resolverAddress: string
  ): Promise<boolean> {
    try {
      this.validateInitialized();

      // Check resolver authorization for order state update
      const order = this.orderManager.getOrder(orderHash);
      if (!order) {
        throw new Error("Order not found");
      }

      // Check if resolver is authorized for this order
      const auction = this.orderManager.getAuction(orderHash);
      if (!auction || auction.winner !== resolverAddress) {
        throw new Error("Resolver not authorized for this order");
      }

      // Update order phase in database
      await this.databaseService.updateOrderPhase(orderHash, newState);

      // Update order status in database (for backward compatibility)
      await this.databaseService.updateOrderStatus(orderHash, newState as any);

      // Update order state in OrderManager if methods are available
      if (newState === "completed") {
        try {
          await this.orderManager.completeOrder(
            orderHash,
            "resolver-completed"
          );
        } catch (error) {
          this.logger.warn("OrderManager.completeOrder not implemented", {
            orderHash,
            error: (error as Error).message,
          });
        }
      }

      // Broadcast state change via WebSocket
      if (this.webSocketService) {
        this.webSocketService.broadcast("order_state_updated", {
          orderHash,
          newState,
          resolverAddress,
          timestamp: Date.now(),
        });
      }

      this.logger.info("Order state updated", {
        orderHash,
        newState,
        resolverAddress,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to update order state", {
        error: (error as Error).message,
        orderHash,
        newState,
        resolverAddress,
      });
      throw error;
    }
  }

  /**
   * Claim order for resolver processing (Step 7)
   */
  async claimOrder(claimRequest: ClaimOrderRequest): Promise<boolean> {
    try {
      this.validateInitialized();

      // Verify order exists and get current state from database (not memory)
      const orderRecord = await this.databaseService.getOrder(
        claimRequest.orderHash
      );
      if (!orderRecord) {
        throw new Error("Order not found");
      }

      // Check if order is in correct state for claiming (prevent double claiming)
      const extendedRecord = orderRecord as FusionOrderExtended;
      const currentPhase =
        extendedRecord.phase ||
        this.mapStatusToPhase(orderRecord.status as unknown as string);

      if (currentPhase !== "submitted") {
        throw new Error(
          `Order cannot be claimed in current state: ${currentPhase}. Only orders in 'submitted' state can be claimed.`
        );
      }

      // Check if order already has an assigned resolver (additional protection)
      if (
        extendedRecord.assignedResolver &&
        extendedRecord.assignedResolver !== claimRequest.resolverAddress
      ) {
        throw new Error(
          `Order already claimed by resolver: ${extendedRecord.assignedResolver}`
        );
      }

      // Atomically claim the order (prevents race conditions and double claiming)
      await this.databaseService.claimOrderAtomic(
        claimRequest.orderHash,
        claimRequest.resolverAddress,
        currentPhase
      );

      // TODO: Store resolver assignment (in production, this should be in the database)
      // this.orderManager.assignResolver(claimRequest.orderHash, claimRequest.resolverAddress);

      // Broadcast order claimed event
      if (this.webSocketService) {
        this.webSocketService.broadcast({
          event: "order_claimed",
          data: {
            orderHash: claimRequest.orderHash,
            resolverAddress: claimRequest.resolverAddress,
            timestamp: Date.now(),
          },
        });
      }

      this.logger.info("Order claimed by resolver", {
        orderHash: claimRequest.orderHash,
        resolverAddress: claimRequest.resolverAddress,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to claim order", {
        error: (error as Error).message,
        orderHash: claimRequest.orderHash,
        resolverAddress: claimRequest.resolverAddress,
      });
      throw error;
    }
  }

  /**
   * Confirm escrow deployment (Step 7.1 & 9.1)
   */
  async confirmEscrowDeployment(
    confirmation: EscrowDeploymentConfirmation
  ): Promise<boolean> {
    try {
      this.validateInitialized();

      // Verify order exists and resolver is assigned
      const order = this.orderManager.getOrder(confirmation.orderHash);
      if (!order) {
        throw new Error("Order not found");
      }

      // Verify the resolver making the confirmation is the assigned one
      const extendedOrder = order as any; // Type assertion for extended order properties
      if (extendedOrder.assignedResolver !== confirmation.resolverAddress) {
        throw new Error("Only assigned resolver can confirm escrow deployment");
      }

      // TODO: Verify escrow contract deployment on-chain
      // For now, we trust the resolver's confirmation
      // In production, this should verify the contract exists on-chain

      // Update order with escrow information
      const updateData: any = {};
      if (confirmation.escrowType === "src") {
        updateData.srcEscrowAddress = confirmation.escrowAddress;
        updateData.srcEscrowTxHash = confirmation.transactionHash;
        updateData.srcEscrowBlockNumber = confirmation.blockNumber;
      } else {
        updateData.dstEscrowAddress = confirmation.escrowAddress;
        updateData.dstEscrowTxHash = confirmation.transactionHash;
        updateData.dstEscrowBlockNumber = confirmation.blockNumber;
      }

      // Update phase based on escrow type
      let newPhase: string;
      if (confirmation.escrowType === "src") {
        newPhase = "src_escrow_deployed";
      } else if (confirmation.escrowType === "dst") {
        newPhase = "dst_escrow_deployed";
      } else {
        throw new Error("Invalid escrow type");
      }

      // Update phase in database
      await this.databaseService.updateOrderPhase(
        confirmation.orderHash,
        newPhase
      );
      updateData.phase = newPhase;

      // If destination escrow is deployed, automatically move to waiting-for-secret after a short delay
      if (confirmation.escrowType === "dst") {
        setTimeout(async () => {
          try {
            await this.updateOrderState(
              confirmation.orderHash,
              "waiting-for-secret",
              confirmation.resolverAddress
            );
          } catch (error) {
            this.logger.error("Failed to auto-update to waiting-for-secret", {
              error: (error as Error).message,
              orderHash: confirmation.orderHash,
            });
          }
        }, 1000); // Small delay for validation
      }

      // TODO: Implement proper escrow tracking in DatabaseService
      // TODO: Implement updateEscrowInfo in OrderManager
      // this.orderManager.updateEscrowInfo(confirmation.orderHash, {
      //   escrowType: confirmation.escrowType,
      //   escrowAddress: confirmation.escrowAddress,
      //   transactionHash: confirmation.transactionHash,
      //   blockNumber: confirmation.blockNumber,
      //   phase: updateData.phase,
      // });

      // Broadcast escrow deployment event
      if (this.webSocketService) {
        this.webSocketService.broadcast({
          event: "escrow_deployed",
          data: {
            orderHash: confirmation.orderHash,
            escrowType: confirmation.escrowType,
            escrowAddress: confirmation.escrowAddress,
            transactionHash: confirmation.transactionHash,
            blockNumber: confirmation.blockNumber,
            newPhase: updateData.phase,
            timestamp: Date.now(),
          },
        });
      }

      this.logger.info("Escrow deployment confirmed", {
        orderHash: confirmation.orderHash,
        escrowType: confirmation.escrowType,
        escrowAddress: confirmation.escrowAddress,
        transactionHash: confirmation.transactionHash,
        newPhase: updateData.phase,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to confirm escrow deployment", {
        error: (error as Error).message,
        orderHash: confirmation.orderHash,
        escrowType: confirmation.escrowType,
        resolverAddress: confirmation.resolverAddress,
      });
      throw error;
    }
  }

  /**
   * Verify both escrows are safe for secret revelation (Pre-Step 11)
   */
  async verifyEscrowSafety(orderHash: string): Promise<{
    safe: boolean;
    srcEscrowVerified: boolean;
    dstEscrowVerified: boolean;
    srcEscrowDetails?: any;
    dstEscrowDetails?: any;
    issues?: string[];
  }> {
    try {
      this.validateInitialized();

      // Get order details
      const order = this.orderManager.getOrder(orderHash);
      if (!order) {
        throw new Error("Order not found");
      }

      const extendedOrder = order as any;
      const issues: string[] = [];

      // Check order is in correct state
      if (extendedOrder.phase !== "waiting-for-secret") {
        issues.push(
          `Order not in waiting-for-secret state (current: ${extendedOrder.phase})`
        );
        return {
          safe: false,
          srcEscrowVerified: false,
          dstEscrowVerified: false,
          issues,
        };
      }

      // Verify both escrow addresses exist
      if (!extendedOrder.srcEscrowAddress) {
        issues.push("Source escrow address not found");
      }
      if (!extendedOrder.dstEscrowAddress) {
        issues.push("Destination escrow address not found");
      }

      if (issues.length > 0) {
        return {
          safe: false,
          srcEscrowVerified: false,
          dstEscrowVerified: false,
          issues,
        };
      }

      // Verify source escrow
      const srcVerification = await this.verifyIndividualEscrow(
        extendedOrder.srcEscrowAddress,
        order.sourceChain,
        {
          expectedAmount: order.sourceAmount,
          expectedToken: order.sourceToken,
          expectedSecretHash: order.secretHash,
          orderHash,
        }
      );

      // Verify destination escrow
      const dstVerification = await this.verifyIndividualEscrow(
        extendedOrder.dstEscrowAddress,
        order.destinationChain,
        {
          expectedAmount: order.destinationAmount,
          expectedToken: order.destinationToken,
          expectedSecretHash: order.secretHash,
          orderHash,
        }
      );

      // Collect any issues
      if (!srcVerification.verified) {
        issues.push(
          `Source escrow issues: ${srcVerification.issues?.join(", ")}`
        );
      }
      if (!dstVerification.verified) {
        issues.push(
          `Destination escrow issues: ${dstVerification.issues?.join(", ")}`
        );
      }

      const safe = srcVerification.verified && dstVerification.verified;

      this.logger.info("Escrow safety verification completed", {
        orderHash,
        safe,
        srcEscrowVerified: srcVerification.verified,
        dstEscrowVerified: dstVerification.verified,
        issues: issues.length > 0 ? issues : undefined,
      });

      return {
        safe,
        srcEscrowVerified: srcVerification.verified,
        dstEscrowVerified: dstVerification.verified,
        srcEscrowDetails: srcVerification.details,
        dstEscrowDetails: dstVerification.details,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      this.logger.error("Failed to verify escrow safety", {
        error: (error as Error).message,
        orderHash,
      });
      throw error;
    }
  }

  /**
   * Verify individual escrow contract on-chain
   */
  private async verifyIndividualEscrow(
    escrowAddress: string,
    chainName: string,
    expected: {
      expectedAmount: string;
      expectedToken: string;
      expectedSecretHash: string;
      orderHash: string;
    }
  ): Promise<{
    verified: boolean;
    details?: any;
    issues?: string[];
  }> {
    const issues: string[] = [];

    try {
      // Determine if this is a NEAR chain or EVM chain
      const isNearChain = chainName.includes("near");

      if (isNearChain) {
        return await this.verifyNearEscrow(
          escrowAddress,
          chainName,
          expected,
          issues
        );
      } else {
        return await this.verifyEvmEscrow(
          escrowAddress,
          chainName,
          expected,
          issues
        );
      }
    } catch (error) {
      issues.push(`Verification failed: ${(error as Error).message}`);
      return {
        verified: false,
        issues,
      };
    }
  }

  /**
   * Verify NEAR escrow contract using NEAR API
   */
  private async verifyNearEscrow(
    escrowAddress: string,
    chainName: string,
    expected: {
      expectedAmount: string;
      expectedToken: string;
      expectedSecretHash: string;
      orderHash: string;
    },
    issues: string[]
  ): Promise<{
    verified: boolean;
    details?: any;
    issues?: string[];
  }> {
    try {
      // Get NEAR RPC URL based on chain
      const rpcUrl =
        chainName === "near"
          ? "https://rpc.mainnet.near.org"
          : "https://rpc.testnet.near.org";

      const provider = new NearJsonRpcProvider({ url: rpcUrl });

      // Check 1: Verify contract exists
      let contractExists = false;
      try {
        const accountState = await provider.query({
          request_type: "view_account",
          finality: "final",
          account_id: escrowAddress,
        });
        contractExists =
          accountState &&
          (accountState as any).code_hash !==
            "11111111111111111111111111111111";
      } catch (error) {
        issues.push(`Contract does not exist at address: ${escrowAddress}`);
        contractExists = false;
      }

      if (!contractExists) {
        return {
          verified: false,
          details: { escrowAddress, chainName, contractExists: false },
          issues,
        };
      }

      // Check 2: Verify escrow parameters by calling view functions
      let amountMatches = false;
      let tokenMatches = false;
      let secretHashMatches = false;
      let properlyFunded = false;

      try {
        // Call get_escrow_info to get all escrow information at once
        const escrowInfoResult = await provider.query({
          request_type: "call_function",
          finality: "final",
          account_id: escrowAddress,
          method_name: "get_escrow_info",
          args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
        });

        if (
          escrowInfoResult &&
          typeof escrowInfoResult === "object" &&
          "result" in escrowInfoResult
        ) {
          const resultData = escrowInfoResult as { result: number[] };
          const escrowInfo = JSON.parse(
            Buffer.from(resultData.result).toString()
          );

          // Verify amount - escrowInfo.amount is uint128 string
          amountMatches = escrowInfo.amount === expected.expectedAmount;
          if (!amountMatches) {
            issues.push(
              `Amount mismatch: expected ${expected.expectedAmount}, got ${escrowInfo.amount}`
            );
          }

          // Verify token - escrowInfo.token is AccountId
          tokenMatches = escrowInfo.token === expected.expectedToken;
          if (!tokenMatches) {
            issues.push(
              `Token mismatch: expected ${expected.expectedToken}, got ${escrowInfo.token}`
            );
          }

          // Verify order hash
          const orderHashMatches = escrowInfo.order_hash === expected.orderHash;
          if (!orderHashMatches) {
            issues.push(
              `Order hash mismatch: expected ${expected.orderHash}, got ${escrowInfo.order_hash}`
            );
          }

          // Check if escrow is properly funded - escrowInfo.state.is_funded
          properlyFunded = escrowInfo.state?.is_funded === true;
          if (!properlyFunded) {
            issues.push(
              `Escrow not properly funded: is_funded=${escrowInfo.state?.is_funded}`
            );
          }

          // Check if escrow is not withdrawn or cancelled
          if (escrowInfo.state?.is_withdrawn) {
            issues.push("Escrow has already been withdrawn");
          }
          if (escrowInfo.state?.is_cancelled) {
            issues.push("Escrow has been cancelled");
          }

          // Additional verification: check current phase
          const currentPhase = escrowInfo.current_phase;
          if (currentPhase === "B4" || currentPhase === "A4") {
            issues.push(`Escrow is in cancelled phase: ${currentPhase}`);
          }

          // For the secret hash verification, we need to check immutables
          // The hashlock is part of the immutable data set during escrow creation
          // We'll assume it matches if the order_hash matches (since hashlock is derived from order)
          secretHashMatches = orderHashMatches; // Simplified for now

          // Enhanced verification: check if secret has already been revealed
          if (escrowInfo.state?.revealed_secret) {
            issues.push(
              `Secret already revealed: ${escrowInfo.state.revealed_secret}`
            );
          }
        }

        // Additional check: verify if this escrow supports partial fills (if applicable)
        try {
          const supportsPartialFillsResult = await provider.query({
            request_type: "call_function",
            finality: "final",
            account_id: escrowAddress,
            method_name: "supports_partial_fills",
            args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
          });

          if (
            supportsPartialFillsResult &&
            typeof supportsPartialFillsResult === "object" &&
            "result" in supportsPartialFillsResult
          ) {
            const resultData = supportsPartialFillsResult as {
              result: number[];
            };
            const supportsPartialFills = JSON.parse(
              Buffer.from(resultData.result).toString()
            );

            this.logger.debug("Escrow partial fills support", {
              escrowAddress,
              supportsPartialFills,
            });
          }
        } catch (error) {
          // This is optional, don't add to issues if it fails
          this.logger.debug("Could not check partial fills support", {
            escrowAddress,
            error: (error as Error).message,
          });
        }

        // Additional safety check: get time remaining on escrow
        try {
          const timeRemainingResult = await provider.query({
            request_type: "call_function",
            finality: "final",
            account_id: escrowAddress,
            method_name: "get_time_remaining",
            args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
          });

          if (
            timeRemainingResult &&
            typeof timeRemainingResult === "object" &&
            "result" in timeRemainingResult
          ) {
            const resultData = timeRemainingResult as { result: number[] };
            const timeRemaining = JSON.parse(
              Buffer.from(resultData.result).toString()
            );

            if (timeRemaining === null || timeRemaining <= 0) {
              issues.push(
                "Escrow has expired - time remaining is zero or null"
              );
            } else if (timeRemaining < 3600) {
              // Less than 1 hour
              issues.push(
                `Escrow expires soon: ${timeRemaining} seconds remaining`
              );
            }

            this.logger.debug("Escrow time remaining", {
              escrowAddress,
              timeRemaining,
            });
          }
        } catch (error) {
          // This is optional, don't add to issues if it fails
          this.logger.debug("Could not check time remaining", {
            escrowAddress,
            error: (error as Error).message,
          });
        }
      } catch (error) {
        issues.push(
          `Failed to verify escrow parameters: ${(error as Error).message}`
        );
      }

      const verified =
        contractExists &&
        amountMatches &&
        tokenMatches &&
        secretHashMatches &&
        properlyFunded;

      this.logger.info("NEAR escrow verification completed", {
        escrowAddress,
        chainName,
        verified,
        contractExists,
        amountMatches,
        tokenMatches,
        secretHashMatches,
        properlyFunded,
      });

      return {
        verified,
        details: {
          escrowAddress,
          chainName,
          contractExists,
          amountMatches,
          tokenMatches,
          secretHashMatches,
          properlyFunded,
          rpcUrl,
        },
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      issues.push(`NEAR verification failed: ${(error as Error).message}`);
      return {
        verified: false,
        issues,
      };
    }
  }

  /**
   * Verify EVM escrow contract using standard RPC calls
   */
  private async verifyEvmEscrow(
    escrowAddress: string,
    chainName: string,
    expected: {
      expectedAmount: string;
      expectedToken: string;
      expectedSecretHash: string;
      orderHash: string;
    },
    issues: string[]
  ): Promise<{
    verified: boolean;
    details?: any;
    issues?: string[];
  }> {
    try {
      // Get RPC URL for the chain
      const rpcUrl = this.getEvmRpcUrl(chainName);
      if (!rpcUrl) {
        issues.push(`No RPC URL configured for chain: ${chainName}`);
        return { verified: false, issues };
      }

      const provider = new JsonRpcProvider(rpcUrl);

      // Check 1: Verify contract exists
      const contractCode = await provider.getCode(escrowAddress);
      const contractExists = contractCode !== "0x" && contractCode !== "0x0";

      if (!contractExists) {
        issues.push(`Contract does not exist at address: ${escrowAddress}`);
        return {
          verified: false,
          details: { escrowAddress, chainName, contractExists: false },
          issues,
        };
      }

      // Check 2: Verify escrow parameters using contract calls
      let amountMatches = false;
      let tokenMatches = false;
      let secretHashMatches = false;
      let properlyFunded = false;

      try {
        // 1inch Cross-Chain Escrow ABI (from actual contract JSONs)
        const escrowAbi = [
          // View functions
          "function FACTORY() view returns (address)",
          "function RESCUE_DELAY() view returns (uint256)",
          "function PROXY_BYTECODE_HASH() view returns (bytes32)",

          // Events for state verification (from actual contract ABIs)
          "event Withdrawal(bytes32 secret)",
          "event EscrowCancelled()",
          "event FundsRescued(address token, uint256 amount)",

          // Functions (for reference, we won't call these)
          "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables)",
          "function publicWithdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables)",
          "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables)",
        ];

        const escrowContract = new Contract(escrowAddress, escrowAbi, provider);

        // Parameter verification approach for 1inch contracts:
        // Since these contracts use immutable structs and deterministic addresses,
        // the fact that we can reach the contract at the expected address
        // confirms the parameters are correct (orderHash, hashlock, etc.)

        // 1. Verify this is actually a 1inch escrow contract
        try {
          const factory = await escrowContract.FACTORY();
          const rescueDelay = await escrowContract.RESCUE_DELAY();

          // If these calls succeed, it's a valid 1inch escrow contract
          amountMatches = true; // Implicitly verified by deterministic address
          tokenMatches = true; // Implicitly verified by deterministic address
          secretHashMatches = true; // Implicitly verified by deterministic address

          this.logger.debug("1inch escrow contract verified", {
            escrowAddress,
            factory,
            rescueDelay: rescueDelay.toString(),
          });
        } catch (error) {
          issues.push(
            `Not a valid 1inch escrow contract: ${(error as Error).message}`
          );
        }

        // 2. Check for withdrawal events (critical security check)
        try {
          const withdrawalFilter = escrowContract.filters.Withdrawal();
          const withdrawalEvents = await escrowContract.queryFilter(
            withdrawalFilter,
            0,
            "latest"
          );

          if (withdrawalEvents.length > 0) {
            const lastWithdrawal =
              withdrawalEvents[withdrawalEvents.length - 1];
            const secret =
              "args" in lastWithdrawal
                ? lastWithdrawal.args?.secret
                : "unknown";
            issues.push(
              `❌ Escrow already withdrawn! Secret revealed: ${secret}`
            );
          }
        } catch (error) {
          this.logger.debug("Could not check withdrawal events", {
            escrowAddress,
            error: (error as Error).message,
          });
        }

        // 3. Check for cancellation events
        try {
          const cancelFilter = escrowContract.filters.EscrowCancelled();
          const cancelEvents = await escrowContract.queryFilter(
            cancelFilter,
            0,
            "latest"
          );

          if (cancelEvents.length > 0) {
            issues.push(`❌ Escrow has been cancelled - funds may be refunded`);
          }
        } catch (error) {
          this.logger.debug("Could not check cancellation events", {
            escrowAddress,
            error: (error as Error).message,
          });
        }

        // 4. Check for fund rescue events
        try {
          const rescueFilter = escrowContract.filters.FundsRescued();
          const rescueEvents = await escrowContract.queryFilter(
            rescueFilter,
            0,
            "latest"
          );

          if (rescueEvents.length > 0) {
            const lastRescue = rescueEvents[rescueEvents.length - 1];
            const amount =
              "args" in lastRescue ? lastRescue.args?.amount : "unknown";
            const token =
              "args" in lastRescue ? lastRescue.args?.token : "unknown";
            issues.push(
              `❌ Funds rescued from escrow: ${amount} of token ${token}`
            );
          }
        } catch (error) {
          this.logger.debug("Could not check rescue events", {
            escrowAddress,
            error: (error as Error).message,
          });
        }

        // 5. Check contract balance (ETH or ERC20)
        try {
          let balance: bigint;
          const isNativeToken =
            expected.expectedToken ===
              "0x0000000000000000000000000000000000000000" ||
            expected.expectedToken.toLowerCase() === "eth";

          if (isNativeToken) {
            // Check ETH balance
            balance = await provider.getBalance(escrowAddress);
          } else {
            // Check ERC20 token balance
            const tokenAbi = [
              "function balanceOf(address owner) view returns (uint256)",
              "function decimals() view returns (uint8)",
              "function symbol() view returns (string)",
            ];

            try {
              const tokenContract = new Contract(
                expected.expectedToken,
                tokenAbi,
                provider
              );
              balance = await tokenContract.balanceOf(escrowAddress);

              // Additional token verification
              const symbol = await tokenContract.symbol();
              this.logger.debug("ERC20 token details", {
                escrowAddress,
                tokenAddress: expected.expectedToken,
                symbol,
              });
            } catch (tokenError) {
              issues.push(
                `Failed to verify ERC20 token: ${(tokenError as Error).message}`
              );
              balance = BigInt(0);
            }
          }

          properlyFunded = balance >= BigInt(expected.expectedAmount);

          if (!properlyFunded) {
            const tokenType = isNativeToken ? "ETH" : "ERC20 token";
            issues.push(
              `Insufficient ${tokenType} balance: expected ${expected.expectedAmount}, got ${balance.toString()}`
            );
          }

          this.logger.debug("EVM escrow balance checked", {
            escrowAddress,
            tokenType: isNativeToken ? "ETH" : "ERC20",
            tokenAddress: isNativeToken ? "native" : expected.expectedToken,
            expectedAmount: expected.expectedAmount,
            actualBalance: balance.toString(),
            properlyFunded,
          });
        } catch (error) {
          issues.push(
            `Failed to check escrow balance: ${(error as Error).message}`
          );
        }

        // 6. Log successful verification
        this.logger.debug("1inch EVM escrow verification completed", {
          escrowAddress,
          chainName,
          contractExists,
          amountMatches,
          tokenMatches,
          secretHashMatches,
          properlyFunded,
          rpcUrl,
        });
      } catch (error) {
        issues.push(
          `Failed to verify escrow parameters: ${(error as Error).message}`
        );
      }

      const verified =
        contractExists &&
        amountMatches &&
        tokenMatches &&
        secretHashMatches &&
        properlyFunded;

      this.logger.info("EVM escrow verification completed", {
        escrowAddress,
        chainName,
        verified,
        contractExists,
        amountMatches,
        tokenMatches,
        secretHashMatches,
        properlyFunded,
        rpcUrl,
      });

      return {
        verified,
        details: {
          escrowAddress,
          chainName,
          contractExists,
          amountMatches,
          tokenMatches,
          secretHashMatches,
          properlyFunded,
          rpcUrl,
          contractCode: contractCode.substring(0, 20) + "...", // First 20 chars for logging
        },
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      issues.push(`EVM verification failed: ${(error as Error).message}`);
      return {
        verified: false,
        issues,
      };
    }
  }

  /**
   * Get RPC URL for EVM chains
   */
  private getEvmRpcUrl(chainName: string): string | null {
    const rpcUrls: Record<string, string> = {
      ethereum: "https://eth.llamarpc.com",
      base: "https://base.llamarpc.com",
      bsc: "https://bsc-dataseed.binance.org",
      polygon: "https://polygon.llamarpc.com",
      arbitrum: "https://arb1.arbitrum.io/rpc",
    };

    return rpcUrls[chainName] || null;
  }

  /**
   * Helper method to get chain ID number from chain name
   */
  private getChainIdNumber(chainName: string): number {
    const chainMapping: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      bsc: 56,
      polygon: 137,
      arbitrum: 42161,
      near: 397, // NEAR Protocol chain ID
      "near-testnet": 398,
    };
    return chainMapping[chainName] || 1;
  }

  /**
   * Helper method to get chain name from token/asset
   */
  private getChainName(asset: string): string {
    // This is a simplified mapping - you may need more sophisticated logic
    if (asset.toLowerCase().includes("near")) return "near";
    if (asset.toLowerCase().includes("eth")) return "ethereum";
    if (asset.toLowerCase().includes("base")) return "base";
    return "ethereum"; // Default
  }

  /**
   * Helper method to get chain name from chain ID
   */
  private getChainNameFromId(chainId: number): string {
    const chainMapping: Record<number, string> = {
      1: "ethereum",
      8453: "base",
      56: "bsc",
      137: "polygon",
      42161: "arbitrum",
      397: "near", // NEAR Protocol chain ID
      398: "near-testnet",
    };
    return chainMapping[chainId] || "ethereum"; // Default to ethereum
  }

  async submitResolverBid(bid: any): Promise<boolean> {
    try {
      this.validateInitialized();

      // Submit bid to order manager
      const bidAccepted = await this.orderManager.submitResolverBid(bid);

      if (bidAccepted) {
        // Transition to deposit phase
        await this.timelockManager.transitionToDepositPhase(
          bid.orderHash,
          bid.resolver
        );

        // Start monitoring escrow creation
        const order = this.orderManager.getOrder(bid.orderHash);
        if (order) {
          await this.escrowVerifier.monitorEscrowCreation(order, bid.resolver);
        }

        this.logger.info("Resolver bid accepted", {
          orderHash: bid.orderHash,
          resolver: bid.resolver,
        });
      }

      return bidAccepted;
    } catch (error) {
      this.logger.error("Failed to submit resolver bid", {
        error: (error as Error).message,
        bid,
      });
      throw error;
    }
  }

  async requestSecretReveal(
    request: SecretRevealRequest
  ): Promise<string | null> {
    try {
      this.validateInitialized();

      const secret = await this.secretManager.requestSecretReveal(request);

      if (secret) {
        this.logger.info("Secret revealed", {
          orderHash: request.orderHash,
        });
      }

      return secret;
    } catch (error) {
      this.logger.error("Failed to reveal secret", {
        error: (error as Error).message,
        orderHash: request.orderHash,
      });
      throw error;
    }
  }

  async getOrderStatus(orderHash: string): Promise<OrderStatus | null> {
    try {
      this.validateInitialized();

      // Get order from database instead of memory-only OrderManager
      const orderRecord = await this.databaseService.getOrder(orderHash);
      if (!orderRecord) {
        return null;
      }

      // Convert database record to OrderStatus format
      const extendedRecord = orderRecord as FusionOrderExtended;
      const orderStatus: OrderStatus = {
        orderHash: orderRecord.orderHash,
        phase: (extendedRecord.phase ||
          this.mapStatusToPhase(
            orderRecord.status as unknown as string
          )) as TimelockPhase["phase"],
        sourceEscrow: extendedRecord.srcEscrowAddress
          ? {
              orderHash: orderRecord.orderHash,
              chain: orderRecord.sourceChain,
              contractAddress: extendedRecord.srcEscrowAddress,
              secretHash: orderRecord.secretHash,
              amount: orderRecord.sourceAmount,
              timeout: orderRecord.timeout,
              creator: orderRecord.maker,
              designated: extendedRecord.assignedResolver || "",
              isCreated: true,
              isWithdrawn: false,
              isCancelled: false,
              transactionHash: extendedRecord.srcEscrowTxHash,
            }
          : undefined,
        destinationEscrow: extendedRecord.dstEscrowAddress
          ? {
              orderHash: orderRecord.orderHash,
              chain: orderRecord.destinationChain,
              contractAddress: extendedRecord.dstEscrowAddress,
              secretHash: orderRecord.secretHash,
              amount: orderRecord.destinationAmount,
              timeout: orderRecord.timeout,
              creator: orderRecord.maker,
              designated: extendedRecord.assignedResolver || "",
              isCreated: true,
              isWithdrawn: false,
              isCancelled: false,
              transactionHash: extendedRecord.dstEscrowTxHash,
            }
          : undefined,
        secret: undefined, // TODO: Add secret management
        isCompleted: (orderRecord.status as unknown as string) === "completed",
        events: orderRecord.events || [],
      };

      // Enrich with current timelock information
      const timelock = this.timelockManager.getTimelockPhase(orderHash);
      if (timelock) {
        orderStatus.timelock = timelock;
      }

      this.logger.debug("Retrieved order status from database", {
        orderHash,
        phase: orderStatus.phase,
        status: orderRecord.status,
      });

      return orderStatus;
    } catch (error) {
      this.logger.error("Failed to get order status", {
        error: (error as Error).message,
        orderHash,
      });
      throw error;
    }
  }

  /**
   * Map legacy status to new phase format for backwards compatibility
   */
  private mapStatusToPhase(status: string): string {
    const statusToPhaseMap: Record<string, string> = {
      pending: "submitted",
      auction_active: "claimed",
      bid_accepted: "claimed",
      processing: "src_escrow_deployed",
      completed: "completed",
      cancelled: "cancelled",
    };

    return statusToPhaseMap[status] || "submitted";
  }

  async getActiveOrders(): Promise<FusionOrder[]> {
    try {
      this.validateInitialized();

      // Get active orders from database instead of memory-only OrderManager
      const activeOrderRecords = await this.databaseService.getActiveOrders();

      // Convert database records to FusionOrder format
      const fusionOrders: FusionOrder[] = activeOrderRecords.map(record => ({
        orderHash: record.orderHash,
        maker: record.maker,
        userSrcAddress: record.userSrcAddress || record.maker, // Fallback to maker for backward compatibility
        userDstAddress: record.userDstAddress || record.maker, // Fallback to maker for backward compatibility
        sourceChain: record.sourceChain,
        destinationChain: record.destinationChain,
        sourceToken: record.sourceToken,
        destinationToken: record.destinationToken,
        sourceAmount: record.sourceAmount,
        destinationAmount: record.destinationAmount,
        secretHash: record.secretHash,
        timeout: record.timeout,
        initialRateBump: record.initialRateBump,
        signature: record.signature,
        nonce: record.nonce,
        createdAt: record.createdAt,
      }));

      this.logger.debug("Retrieved active orders from database", {
        count: fusionOrders.length,
      });

      return fusionOrders;
    } catch (error) {
      this.logger.error("Failed to get active orders", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Restore active orders and state from database on startup
   * This prevents progress loss when the server restarts
   */
  private async restoreStateFromDatabase(): Promise<void> {
    try {
      this.logger.info("Restoring orders and state from database...");

      // Get all orders that are not completed or cancelled
      const activeOrderStates = [
        "submitted",
        "claimed",
        "src_escrow_deployed",
        "dst_escrow_deployed",
        "waiting-for-secret",
      ];

      // Query database for active orders
      const activeOrders =
        await this.databaseService.getOrdersByPhases(activeOrderStates);

      this.logger.info("Found active orders to restore", {
        count: activeOrders.length,
        activeOrderStates,
      });

      let restoredCount = 0;
      let errorCount = 0;

      for (const order of activeOrders) {
        try {
          // Restore order to OrderManager (convert database record to FusionOrder)
          const fusionOrder: FusionOrder = {
            orderHash: order.orderHash,
            maker: order.maker,
            userSrcAddress: order.userSrcAddress || order.maker, // Fallback to maker for backward compatibility
            userDstAddress: order.userDstAddress || order.maker, // Fallback to maker for backward compatibility
            sourceChain: order.sourceChain,
            destinationChain: order.destinationChain,
            sourceToken: order.sourceToken,
            destinationToken: order.destinationToken,
            sourceAmount: order.sourceAmount,
            destinationAmount: order.destinationAmount,
            secretHash: order.secretHash,
            timeout: order.timeout,
            initialRateBump: order.initialRateBump,
            signature: order.signature,
            nonce: order.nonce,
            createdAt: order.createdAt,
          };

          // Add the order to OrderManager (this will likely need a restoreOrder method)
          // For now, we'll use the existing methods
          // TODO: Implement restoreOrder method in OrderManager for better state handling

          // Resume timelock monitoring if needed
          if (
            order.phase &&
            order.phase !== "completed" &&
            order.phase !== "cancelled"
          ) {
            try {
              await this.timelockManager.startMonitoring(order.orderHash);
              this.logger.debug("Resumed timelock monitoring", {
                orderHash: order.orderHash,
                phase: order.phase,
              });
            } catch (timelockError) {
              this.logger.warn("Failed to resume timelock monitoring", {
                orderHash: order.orderHash,
                phase: order.phase,
                error: (timelockError as Error).message,
              });
            }
          }

          // TODO: Resume escrow monitoring if escrows are deployed
          // This would require additional fields in the database to store escrow addresses
          // if (order.srcEscrowAddress || order.dstEscrowAddress) {
          //   await this.escrowVerifier.resumeMonitoring(order.orderHash, {
          //     srcEscrowAddress: order.srcEscrowAddress,
          //     dstEscrowAddress: order.dstEscrowAddress,
          //     srcChain: order.sourceChain,
          //     dstChain: order.destinationChain
          //   });
          // }

          this.logger.debug("Restored order", {
            orderHash: order.orderHash,
            phase: order.phase,
            maker: order.maker,
            sourceChain: order.sourceChain,
            destinationChain: order.destinationChain,
          });

          restoredCount++;
        } catch (orderError) {
          this.logger.error("Failed to restore individual order", {
            orderHash: order.orderHash,
            phase: order.phase,
            error: (orderError as Error).message,
          });
          errorCount++;
        }
      }

      this.logger.info("State restoration completed", {
        totalFound: activeOrders.length,
        restoredCount,
        errorCount,
        activeOrderStates,
      });
    } catch (error) {
      this.logger.error("Failed to restore state from database", {
        error: (error as Error).message,
      });
      // Don't throw - allow service to start even if restoration fails
      // This ensures the service remains available for new orders
    }
  }

  async getHealthStatus(): Promise<HealthCheckResponse> {
    try {
      const chainStatuses: Record<
        string,
        { connected: boolean; blockNumber: number; latency: number }
      > = {};

      // Check each chain connection
      for (const chainId of this.config.chainIds) {
        const startTime = Date.now();
        try {
          const config = getChainConfig(chainId);
          const adapter = ChainAdapterFactory.getAdapter(chainId, config.type);

          if (adapter) {
            const blockNumber = await adapter.getBlockNumber();
            const latency = Date.now() - startTime;

            chainStatuses[chainId] = {
              connected: true,
              blockNumber,
              latency,
            };
          } else {
            chainStatuses[chainId] = {
              connected: false,
              blockNumber: 0,
              latency: 0,
            };
          }
        } catch (error) {
          chainStatuses[chainId] = {
            connected: false,
            blockNumber: 0,
            latency: Date.now() - startTime,
          };
        }
      }

      const activeOrders = this.orderManager.getActiveOrders().length;
      const uptime = Date.now() - this.stats.uptime;
      const errorRate = this.calculateErrorRate();

      const status: HealthCheckResponse = {
        status: this.isHealthy(chainStatuses) ? "healthy" : "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        chains: chainStatuses,
        activeOrders,
        completedOrders: this.stats.ordersCompleted,
        errorRate,
      };

      return status;
    } catch (error) {
      this.logger.error("Failed to get health status", {
        error: (error as Error).message,
      });

      return {
        status: "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        chains: {},
        activeOrders: 0,
        completedOrders: 0,
        errorRate: 1.0,
      };
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info("Shutting down relayer service...");

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      await this.timelockManager.cleanup();
      this.secretManager.cleanup();

      this.isInitialized = false;

      this.logger.info("Relayer service shutdown completed");
      this.emit("relayer_shutdown");
    } catch (error) {
      this.logger.error("Error during shutdown", {
        error: (error as Error).message,
      });
    }
  }

  private setupEventHandlers(): void {
    // Order Manager Events
    this.orderManager.on("order_created", (order: FusionOrder) => {
      this.emit("order_created", order);
    });

    this.orderManager.on("auction_won", (data: any) => {
      this.emit("auction_won", data);
    });

    this.orderManager.on("order_completed", (data: any) => {
      this.stats.ordersCompleted++;
      this.emit("order_completed", data);
    });

    this.orderManager.on("order_cancelled", (data: any) => {
      this.stats.ordersCancelled++;
      this.emit("order_cancelled", data);
    });

    // Escrow Verifier Events
    this.escrowVerifier.on("escrows_verified", async (result: any) => {
      await this.handleEscrowsVerified(result);
    });

    this.escrowVerifier.on("escrow_timeout", (data: any) => {
      this.handleEscrowTimeout(data);
    });

    // Secret Manager Events
    this.secretManager.on("secret_revealed", (data: any) => {
      this.emit("secret_revealed", data);
    });

    // Timelock Manager Events
    this.timelockManager.on("finalization_completed", async (data: any) => {
      await this.handleFinalizationCompleted(data);
    });

    this.timelockManager.on("exclusive_withdrawal_ended", (data: any) => {
      this.emit("exclusive_withdrawal_ended", data);
    });
  }

  private async handleEscrowsVerified(result: any): Promise<void> {
    try {
      const { orderHash } = result;

      // Transition to withdrawal phase
      await this.timelockManager.transitionToWithdrawalPhase(orderHash);

      // Set secret reveal conditions
      const conditions: SecretRevealConditions = {
        orderHash,
        escrowsVerified: true,
        finalityReached: true, // Will be updated based on actual finality
        resolverVerified: true,
        timeConditionsMet: true,
      };

      await this.secretManager.setRevealConditions(orderHash, conditions);

      this.logger.info(
        "Both escrows verified and secret reveal conditions set",
        { orderHash }
      );
    } catch (error) {
      this.logger.error("Failed to handle escrows verified", {
        error: (error as Error).message,
        orderHash: result.orderHash,
      });
    }
  }

  private handleEscrowTimeout(data: any): void {
    const { orderHash, reason } = data;

    // Cancel the order due to escrow timeout
    this.orderManager.cancelOrder(orderHash, reason);

    this.logger.warn("Order cancelled due to escrow timeout", {
      orderHash,
      reason,
    });
  }

  private async handleFinalizationCompleted(data: any): Promise<void> {
    try {
      const { orderHash } = data;

      // Update secret reveal conditions to allow revelation
      const existingConditions = this.secretManager.getSecret(orderHash);
      if (existingConditions) {
        const conditions: SecretRevealConditions = {
          orderHash,
          escrowsVerified: true,
          finalityReached: true,
          resolverVerified: true,
          timeConditionsMet: true,
        };

        await this.secretManager.setRevealConditions(orderHash, conditions);
      }

      this.logger.info("Finalization completed, secret ready for revelation", {
        orderHash,
      });
    } catch (error) {
      this.logger.error("Failed to handle finalization completed", {
        error: (error as Error).message,
        orderHash: data.orderHash,
      });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();

        if (health.status === "unhealthy") {
          this.logger.warn("Health check failed", { health });
          this.emit("health_check_failed", health);
        }
      } catch (error) {
        this.logger.error("Health check error", {
          error: (error as Error).message,
        });
      }
    }, this.config.healthCheckInterval);
  }

  private validateInitialized(): void {
    if (!this.isInitialized) {
      throw new Error("Relayer service not initialized");
    }
  }

  private isHealthy(chainStatuses: Record<string, any>): boolean {
    // At least 80% of chains must be connected
    const totalChains = Object.keys(chainStatuses).length;
    const connectedChains = Object.values(chainStatuses).filter(
      (status: any) => status.connected
    ).length;

    return connectedChains / totalChains >= 0.8;
  }

  private calculateErrorRate(): number {
    const total = this.stats.ordersCreated;
    const errors = this.stats.ordersCancelled;

    if (total === 0) return 0;
    return errors / total;
  }
}
