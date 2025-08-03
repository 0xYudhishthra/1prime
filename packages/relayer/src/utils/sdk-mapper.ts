import {
  SDKCrossChainOrder,
  FusionOrder,
  FusionOrderExtended,
  SDKTimeLocks,
} from "../types";

/**
 * Extract data from SDK CrossChainOrder and convert to our FusionOrderExtended format
 */
export class SDKOrderMapper {
  /**
   * Convert SDK CrossChainOrder to FusionOrderExtended
   */
  static mapSDKOrderToFusionOrder(
    sdkOrder: SDKCrossChainOrder,
    signature: string,
    orderHash: string,
    sourceChain: string,
    destinationChain: string
  ): FusionOrderExtended {
    const { inner } = sdkOrder;
    const { inner: limitOrder, fusionExtension } = inner;

    // Base FusionOrder fields
    const baseFusionOrder: FusionOrder = {
      orderHash,
      maker: limitOrder.maker.val,
      sourceChain,
      destinationChain,
      sourceToken: limitOrder.makerAsset.val,
      destinationToken: limitOrder.takerAsset.val,
      sourceAmount: limitOrder.makingAmount.toString(),
      destinationAmount: limitOrder.takingAmount.toString(),
      secretHash: this.extractSecretHash(fusionExtension.hashLockInfo),
      timeout: this.calculateTimeout(fusionExtension.timeLocks),
      initialRateBump: 0, // Simplified without auction
      signature,
      nonce: limitOrder._salt.toString(),
      createdAt: Date.now(),
    };

    // Extract Merkle tree information for multiple fills
    const merkleTree = this.extractMerkleSecretTree(
      fusionExtension.hashLockInfo
    );

    // Extended fields from SDK
    const extendedFields: Omit<FusionOrderExtended, keyof FusionOrder> = {
      receiver: limitOrder.receiver.val,
      srcSafetyDeposit: fusionExtension.srcSafetyDeposit.toString(),
      dstSafetyDeposit: fusionExtension.dstSafetyDeposit.toString(),

      // Multiple fills support (detect from Merkle tree presence)
      allowPartialFills: !!merkleTree, // Has Merkle tree = supports partial fills
      allowMultipleFills: !!merkleTree, // Has Merkle tree = supports multiple fills
      merkleSecretTree: merkleTree,

      detailedTimeLocks: this.mapTimeLocks(fusionExtension.timeLocks),
      // enhancedAuctionDetails removed - no auctions
    };

    return {
      ...baseFusionOrder,
      ...extendedFields,
    };
  }

  /**
   * Extract secret hash from SDK HashLock structure
   * Handles both single fills and multiple fills (Merkle tree)
   */
  private static extractSecretHash(hashLockInfo: any): string {
    // Multiple fills: Use Merkle root as the primary hash
    if (hashLockInfo.merkleRoot) {
      return hashLockInfo.merkleRoot;
    }

    // Single fill: Use direct secret hash
    if (hashLockInfo.secretHash) {
      return hashLockInfo.secretHash;
    }
    if (hashLockInfo.hash) {
      return hashLockInfo.hash;
    }

    // Fallback - look for any hex string that looks like a hash
    for (const [key, value] of Object.entries(hashLockInfo)) {
      if (
        typeof value === "string" &&
        value.startsWith("0x") &&
        value.length === 66
      ) {
        return value;
      }
    }

    throw new Error("Could not extract secret hash from SDK order");
  }

  /**
   * Extract Merkle tree information for multiple fills
   */
  private static extractMerkleSecretTree(hashLockInfo: any):
    | {
        merkleRoot: string;
        merkleLeaves: string[];
        secretCount: number;
        fillParts: number;
      }
    | undefined {
    // Check if this is a multiple fill order
    if (!hashLockInfo.merkleRoot || !hashLockInfo.merkleLeaves) {
      return undefined;
    }

    const merkleLeaves = Array.isArray(hashLockInfo.merkleLeaves)
      ? hashLockInfo.merkleLeaves
      : [];

    // N+1 secret model: N parts + 1 completion secret
    const secretCount = merkleLeaves.length;
    const fillParts = Math.max(1, secretCount - 1);

    return {
      merkleRoot: hashLockInfo.merkleRoot,
      merkleLeaves,
      secretCount,
      fillParts,
    };
  }

  /**
   * Map SDK TimeLocks to our detailed timelock structure
   */
  private static mapTimeLocks(sdkTimeLocks: SDKTimeLocks) {
    return {
      srcWithdrawal: Number(sdkTimeLocks.srcWithdrawal),
      srcPublicWithdrawal: Number(sdkTimeLocks.srcPublicWithdrawal),
      srcCancellation: Number(sdkTimeLocks.srcCancellation),
      srcPublicCancellation: Number(sdkTimeLocks.srcPublicCancellation),
      dstWithdrawal: Number(sdkTimeLocks.dstWithdrawal),
      dstPublicWithdrawal: Number(sdkTimeLocks.dstPublicWithdrawal),
      dstCancellation: Number(sdkTimeLocks.dstCancellation),
    };
  }

  /**
   * Calculate timeout for backward compatibility
   * Use the longest cancellation timelock as overall timeout
   */
  private static calculateTimeout(sdkTimeLocks: SDKTimeLocks): number {
    const srcTimeout = Math.max(
      Number(sdkTimeLocks.srcCancellation),
      Number(sdkTimeLocks.srcPublicCancellation)
    );
    const dstTimeout = Number(sdkTimeLocks.dstCancellation);

    // Return the maximum timeout + buffer
    return Math.max(srcTimeout, dstTimeout) + 60; // Add 1 minute buffer
  }

  /**
   * Calculate timelock phases based on deployment timestamp
   * KEY INSIGHT: Phases start from escrow deployment time, not order creation!
   */
  static calculateTimelockPhases(
    order: FusionOrderExtended,
    currentTime: number = Date.now()
  ) {
    if (!order.detailedTimeLocks) {
      throw new Error("Order missing detailed timelock information");
    }

    const sourceDeployedAt = (order.sourceEscrowDeployedAt || 0) * 1000; // Convert to ms
    const destinationDeployedAt =
      (order.destinationEscrowDeployedAt || 0) * 1000; // Convert to ms

    return {
      orderHash: order.orderHash,

      // Source chain phases (A1-A5)
      sourcePhases:
        sourceDeployedAt > 0
          ? this.calculateChainPhases(
              sourceDeployedAt,
              order.detailedTimeLocks,
              "source",
              currentTime
            )
          : this.getInactivePhases(),

      // Destination chain phases (B1-B4)
      destinationPhases:
        destinationDeployedAt > 0
          ? this.calculateChainPhases(
              destinationDeployedAt,
              order.detailedTimeLocks,
              "destination",
              currentTime
            )
          : this.getInactivePhases(),

      currentSourcePhase: this.getCurrentPhase(
        sourceDeployedAt,
        order.detailedTimeLocks,
        "source",
        currentTime
      ),
      currentDestinationPhase: this.getCurrentPhase(
        destinationDeployedAt,
        order.detailedTimeLocks,
        "destination",
        currentTime
      ),
    };
  }

  private static calculateChainPhases(
    deployedAt: number,
    timeLocks: NonNullable<FusionOrderExtended["detailedTimeLocks"]>,
    chain: "source" | "destination",
    currentTime: number
  ) {
    if (chain === "source") {
      const A1_end = deployedAt + timeLocks.srcWithdrawal * 1000;
      const A2_end = deployedAt + timeLocks.srcPublicWithdrawal * 1000;
      const A3_end = deployedAt + timeLocks.srcCancellation * 1000;
      const A4_end = deployedAt + timeLocks.srcPublicCancellation * 1000;

      return {
        A1_finalityLock: this.createPhaseInfo(deployedAt, A1_end, currentTime),
        A2_resolverUnlock: this.createPhaseInfo(A1_end, A2_end, currentTime),
        A3_publicUnlock: this.createPhaseInfo(A2_end, A3_end, currentTime),
        A4_resolverCancellation: this.createPhaseInfo(
          A3_end,
          A4_end,
          currentTime
        ),
        A5_publicCancellation: this.createPhaseInfo(
          A4_end,
          Infinity,
          currentTime
        ),
      };
    } else {
      const B1_end = deployedAt + timeLocks.dstWithdrawal * 1000;
      const B2_end = deployedAt + timeLocks.dstPublicWithdrawal * 1000;
      const B3_end = deployedAt + timeLocks.dstCancellation * 1000;

      return {
        B1_finalityLock: this.createPhaseInfo(deployedAt, B1_end, currentTime),
        B2_resolverUnlock: this.createPhaseInfo(B1_end, B2_end, currentTime),
        B3_publicUnlock: this.createPhaseInfo(B2_end, B3_end, currentTime),
        B4_resolverCancellation: this.createPhaseInfo(
          B3_end,
          Infinity,
          currentTime
        ),
      };
    }
  }

  private static createPhaseInfo(
    start: number,
    end: number,
    currentTime: number
  ) {
    return {
      start,
      end: end === Infinity ? 0 : end,
      isActive: currentTime >= start && currentTime < end,
    };
  }

  private static getInactivePhases() {
    const inactive = { start: 0, end: 0, isActive: false };
    return {
      A1_finalityLock: inactive,
      A2_resolverUnlock: inactive,
      A3_publicUnlock: inactive,
      A4_resolverCancellation: inactive,
      A5_publicCancellation: inactive,
      B1_finalityLock: inactive,
      B2_resolverUnlock: inactive,
      B3_publicUnlock: inactive,
      B4_resolverCancellation: inactive,
    };
  }

  private static getCurrentPhase(
    deployedAt: number,
    timeLocks: NonNullable<FusionOrderExtended["detailedTimeLocks"]>,
    chain: "source" | "destination",
    currentTime: number
  ): string {
    if (deployedAt === 0) return "not_deployed";

    const phases = this.calculateChainPhases(
      deployedAt,
      timeLocks,
      chain,
      currentTime
    );

    // Type assertion to handle dynamic phase structure
    const typedPhases = phases as any;

    if (chain === "source") {
      if (typedPhases.A1_finalityLock?.isActive) return "A1";
      if (typedPhases.A2_resolverUnlock?.isActive) return "A2";
      if (typedPhases.A3_publicUnlock?.isActive) return "A3";
      if (typedPhases.A4_resolverCancellation?.isActive) return "A4";
      if (typedPhases.A5_publicCancellation?.isActive) return "A5";
    } else {
      if (typedPhases.B1_finalityLock?.isActive) return "B1";
      if (typedPhases.B2_resolverUnlock?.isActive) return "B2";
      if (typedPhases.B3_publicUnlock?.isActive) return "B3";
      if (typedPhases.B4_resolverCancellation?.isActive) return "B4";
    }

    return "expired";
  }

  /**
   * Check if a specific operation is allowed based on timelock phases
   */
  static isOperationAllowed(
    order: FusionOrderExtended,
    operation: "withdrawal" | "cancellation",
    actor: "resolver" | "public",
    chain: "source" | "destination",
    currentTime: number = Date.now()
  ): boolean {
    if (!order.detailedTimeLocks) return false;

    const phases = this.calculateTimelockPhases(order, currentTime);
    const currentPhase =
      chain === "source"
        ? phases.currentSourcePhase
        : phases.currentDestinationPhase;

    if (operation === "withdrawal") {
      if (actor === "resolver") {
        // Resolver can withdraw during A2/B2 phase
        return currentPhase === (chain === "source" ? "A2" : "B2");
      } else {
        // Public can withdraw during A3/B3 phase
        return currentPhase === (chain === "source" ? "A3" : "B3");
      }
    } else if (operation === "cancellation") {
      if (actor === "resolver") {
        // Resolver can cancel during A4/B4 phase
        return currentPhase === (chain === "source" ? "A4" : "B4");
      } else {
        // Public can cancel during A5 phase (source only)
        return chain === "source" && currentPhase === "A5";
      }
    }

    return false;
  }
}
