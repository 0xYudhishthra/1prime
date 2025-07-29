import { EventEmitter } from "events";
import type { Logger } from "winston";
import { FusionOrderExtended } from "../types";

export interface PartialFillState {
  orderHash: string;
  totalAmount: string; // Total makingAmount of the order
  filledAmount: string; // Amount filled so far
  fillPercentage: number; // 0-100 percentage filled
  fillParts: number; // N parts (from N+1 secrets)
  secretsUsed: number[]; // Which secret indices have been used
  availableSecrets: number[]; // Which secrets are still available
  isCompleted: boolean; // Whether order is 100% filled
  fills: PartialFill[]; // Individual fill records
}

export interface PartialFill {
  fillId: string; // Unique fill identifier
  resolver: string; // Resolver who made this fill
  amount: string; // Amount of this specific fill
  secretIndex: number; // Which secret was used (1-based)
  fillPercentage: number; // Cumulative percentage after this fill
  timestamp: number; // When this fill occurred
  transactionHash?: string; // Transaction hash
}

export class PartialFillManager extends EventEmitter {
  private logger: Logger;
  private fillStates = new Map<string, PartialFillState>();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Initialize partial fill tracking for an order
   * Based on whitepaper Section 2.5: "splitting the original order into N equal parts"
   */
  initializePartialFill(order: FusionOrderExtended): PartialFillState {
    if (!order.merkleSecretTree) {
      throw new Error("Order does not support partial fills - no Merkle tree");
    }

    const { secretCount, fillParts } = order.merkleSecretTree;

    // Generate available secret indices (1-based as per whitepaper)
    const availableSecrets = Array.from(
      { length: secretCount },
      (_, i) => i + 1
    );

    const fillState: PartialFillState = {
      orderHash: order.orderHash,
      totalAmount: order.sourceAmount,
      filledAmount: "0",
      fillPercentage: 0,
      fillParts,
      secretsUsed: [],
      availableSecrets,
      isCompleted: false,
      fills: [],
    };

    this.fillStates.set(order.orderHash, fillState);

    this.logger.info("Partial fill initialized", {
      orderHash: order.orderHash,
      totalAmount: order.sourceAmount,
      fillParts,
      totalSecrets: secretCount,
    });

    return fillState;
  }

  /**
   * Process a partial fill request
   * Implements whitepaper logic: "the index of the secret in the tree corresponds to the fill percentage"
   */
  async processPartialFill(
    orderHash: string,
    resolver: string,
    fillAmount: string,
    proposedSecretIndex: number
  ): Promise<{ success: boolean; secretIndex: number; error?: string }> {
    const fillState = this.fillStates.get(orderHash);
    if (!fillState) {
      return {
        success: false,
        secretIndex: 0,
        error: "Order not found or not partial fill enabled",
      };
    }

    if (fillState.isCompleted) {
      return {
        success: false,
        secretIndex: 0,
        error: "Order already completed",
      };
    }

    // Calculate new fill percentage
    const fillAmountBN = BigInt(fillAmount);
    const totalAmountBN = BigInt(fillState.totalAmount);
    const currentFilledBN = BigInt(fillState.filledAmount);
    const newFilledBN = currentFilledBN + fillAmountBN;
    const newFillPercentage = Number((newFilledBN * 100n) / totalAmountBN);

    // Determine correct secret index based on fill percentage
    const requiredSecretIndex = this.calculateRequiredSecretIndex(
      newFillPercentage,
      fillState.fillParts
    );

    // Validate secret availability
    if (!fillState.availableSecrets.includes(requiredSecretIndex)) {
      return {
        success: false,
        secretIndex: 0,
        error: `Secret ${requiredSecretIndex} already used or invalid`,
      };
    }

    // Create fill record
    const fill: PartialFill = {
      fillId: `${orderHash}-${Date.now()}`,
      resolver,
      amount: fillAmount,
      secretIndex: requiredSecretIndex,
      fillPercentage: newFillPercentage,
      timestamp: Date.now(),
    };

    // Update fill state
    fillState.filledAmount = newFilledBN.toString();
    fillState.fillPercentage = newFillPercentage;
    fillState.secretsUsed.push(requiredSecretIndex);
    fillState.availableSecrets = fillState.availableSecrets.filter(
      s => s !== requiredSecretIndex
    );
    fillState.fills.push(fill);
    fillState.isCompleted = newFillPercentage >= 100;

    this.logger.info("Partial fill processed", {
      orderHash,
      resolver,
      fillAmount,
      secretIndex: requiredSecretIndex,
      newFillPercentage,
      isCompleted: fillState.isCompleted,
    });

    this.emit("partial_fill", {
      orderHash,
      fill,
      fillState,
    });

    if (fillState.isCompleted) {
      this.emit("order_completed", {
        orderHash,
        fillState,
      });
    }

    return {
      success: true,
      secretIndex: requiredSecretIndex,
    };
  }

  /**
   * Calculate which secret index to use based on fill percentage
   * Whitepaper: "For instance, if the order is divided into four parts (25% each),
   * the 1st secret is required for the first 25% fill, the 2nd secret for 50%, etc."
   */
  private calculateRequiredSecretIndex(
    fillPercentage: number,
    fillParts: number
  ): number {
    // Each part represents 100/N percentage
    const partSize = 100 / fillParts;

    // Determine which "part" this fill reaches
    const partReached = Math.ceil(fillPercentage / partSize);

    // Secret index is 1-based
    const secretIndex = Math.min(partReached, fillParts);

    // If we're at exactly 100%, use the completion secret (N+1)
    if (fillPercentage >= 100) {
      return fillParts + 1; // N+1 secret for completion
    }

    return secretIndex;
  }

  /**
   * Handle complex partial fill scenarios from whitepaper examples
   * Example: "first resolver intends to fill an order to 20%, they utilize the first secret"
   */
  calculatePartialFillStrategy(
    currentFillPercentage: number,
    desiredFillPercentage: number,
    fillParts: number
  ): { secretIndex: number; strategy: string } {
    const partSize = 100 / fillParts;

    // Whitepaper example scenarios
    if (desiredFillPercentage <= partSize) {
      // First part (0-25%) → Secret 1
      return {
        secretIndex: 1,
        strategy: `Fill first part (0-${partSize.toFixed(1)}%)`,
      };
    } else if (desiredFillPercentage <= partSize * 2) {
      // Second part (25-50%) → Secret 2
      return {
        secretIndex: 2,
        strategy: `Fill to second part (${partSize.toFixed(1)}-${(
          partSize * 2
        ).toFixed(1)}%)`,
      };
    } else if (desiredFillPercentage <= partSize * 3) {
      // Third part (50-75%) → Secret 3
      return {
        secretIndex: 3,
        strategy: `Fill to third part (${(partSize * 2).toFixed(1)}-${(
          partSize * 3
        ).toFixed(1)}%)`,
      };
    } else if (desiredFillPercentage < 100) {
      // Fourth part (75-100%) → Secret 4
      return {
        secretIndex: 4,
        strategy: `Fill to fourth part (${(partSize * 3).toFixed(1)}-100%)`,
      };
    } else {
      // Complete fill → Secret N+1 (completion secret)
      return {
        secretIndex: fillParts + 1,
        strategy: "Complete fill with completion secret",
      };
    }
  }

  /**
   * Get partial fill state for an order
   */
  getPartialFillState(orderHash: string): PartialFillState | undefined {
    return this.fillStates.get(orderHash);
  }

  /**
   * Check if order supports partial fills
   */
  supportsPartialFills(order: FusionOrderExtended): boolean {
    return !!(order.allowPartialFills && order.merkleSecretTree);
  }

  /**
   * Get next available secret for a fill amount
   */
  getNextAvailableSecret(orderHash: string, fillAmount: string): number | null {
    const fillState = this.fillStates.get(orderHash);
    if (!fillState) return null;

    const newFilledBN = BigInt(fillState.filledAmount) + BigInt(fillAmount);
    const newPercentage = Number(
      (newFilledBN * 100n) / BigInt(fillState.totalAmount)
    );

    return this.calculateRequiredSecretIndex(
      newPercentage,
      fillState.fillParts
    );
  }

  /**
   * Cleanup completed orders
   */
  cleanupCompletedOrder(orderHash: string): void {
    this.fillStates.delete(orderHash);
    this.logger.debug("Cleaned up partial fill state", { orderHash });
  }
}
