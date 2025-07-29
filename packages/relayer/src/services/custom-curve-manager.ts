import { EventEmitter } from "events";
import type { Logger } from "winston";
import { FusionOrderExtended } from "../types";

export interface AuctionPoint {
  delay: number; // Time offset from auction start (seconds)
  coefficient: number; // Price coefficient (0.0 to 1.0)
}

export interface GasAdjustment {
  orderHash: string;
  originalBaseFee: number; // Base fee when order was created
  currentBaseFee: number; // Current network base fee
  adjustmentFactor: number; // Multiplier for price adjustment
  adjustedRate: number; // New rate after gas adjustment
  timestamp: number; // When adjustment was calculated
}

export interface CustomCurveState {
  orderHash: string;
  points: AuctionPoint[]; // Custom price curve points
  startTime: number; // Auction start time
  duration: number; // Total auction duration
  originalRate: number; // Initial rate without adjustments
  gasAdjustments: GasAdjustment[]; // History of gas adjustments
  isActive: boolean; // Whether curve is active
}

export class CustomCurveManager extends EventEmitter {
  private logger: Logger;
  private curveStates = new Map<string, CustomCurveState>();
  private gasMonitoringInterval?: NodeJS.Timeout;
  private currentBaseFee: number = 20000000000; // 20 gwei default

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Initialize custom curve for an order with enhanced auction details
   * Based on whitepaper Section 2.3.4: "price curve is adjusted based on market conditions"
   */
  initializeCustomCurve(order: FusionOrderExtended): CustomCurveState {
    const points = order.enhancedAuctionDetails?.points || [];

    // If no custom points, create default linear curve
    const curvePoints =
      points.length > 0 ? points : this.createDefaultLinearCurve();

    const curveState: CustomCurveState = {
      orderHash: order.orderHash,
      points: curvePoints,
      startTime: order.auctionStartTime,
      duration: order.auctionDuration,
      originalRate: order.initialRateBump,
      gasAdjustments: [],
      isActive: true,
    };

    this.curveStates.set(order.orderHash, curveState);

    this.logger.info("Custom curve initialized", {
      orderHash: order.orderHash,
      pointsCount: curvePoints.length,
      duration: order.auctionDuration,
      hasCustomPoints: points.length > 0,
    });

    return curveState;
  }

  /**
   * Calculate current auction rate with custom curve and gas adjustments
   * Implements Figure 3 logic from whitepaper
   */
  calculateAdjustedRate(
    orderHash: string,
    currentTime: number = Date.now()
  ): number {
    const curveState = this.curveStates.get(orderHash);
    if (!curveState || !curveState.isActive) {
      return 0;
    }

    // Calculate base rate from custom curve
    const baseRate = this.calculateCurveRate(curveState, currentTime);

    // Apply gas adjustments
    const adjustedRate = this.applyGasAdjustments(curveState, baseRate);

    return Math.max(0, Math.round(adjustedRate));
  }

  /**
   * Calculate rate from custom curve points
   * Implements interpolation between auction points
   */
  private calculateCurveRate(
    curveState: CustomCurveState,
    currentTime: number
  ): number {
    const elapsed = currentTime - curveState.startTime;
    const progress = Math.min(elapsed / (curveState.duration * 1000), 1); // 0 to 1
    const elapsedSeconds = elapsed / 1000;

    // If no custom points, use linear decay
    if (curveState.points.length === 0) {
      return curveState.originalRate * (1 - progress);
    }

    // Find the two points to interpolate between
    let beforePoint: AuctionPoint = { delay: 0, coefficient: 1.0 };
    let afterPoint: AuctionPoint = {
      delay: curveState.duration / 1000,
      coefficient: 0.0,
    };

    for (let i = 0; i < curveState.points.length; i++) {
      const point = curveState.points[i];

      if (point.delay <= elapsedSeconds) {
        beforePoint = point;
      }

      if (point.delay >= elapsedSeconds && !afterPoint) {
        afterPoint = point;
        break;
      }
    }

    // Interpolate between the two points
    const timeDiff = afterPoint.delay - beforePoint.delay;
    const timeProgress =
      timeDiff > 0 ? (elapsedSeconds - beforePoint.delay) / timeDiff : 0;

    const coefficientDiff = afterPoint.coefficient - beforePoint.coefficient;
    const currentCoefficient =
      beforePoint.coefficient + coefficientDiff * timeProgress;

    return curveState.originalRate * currentCoefficient;
  }

  /**
   * Apply gas-based price adjustments
   * Implements Figure 3 scenarios from whitepaper
   */
  private applyGasAdjustments(
    curveState: CustomCurveState,
    baseRate: number
  ): number {
    const latestAdjustment =
      curveState.gasAdjustments[curveState.gasAdjustments.length - 1];

    if (!latestAdjustment) {
      // No gas adjustments yet, return base rate
      return baseRate;
    }

    // Apply the latest gas adjustment factor
    return baseRate * latestAdjustment.adjustmentFactor;
  }

  /**
   * Update gas fee and recalculate price adjustments
   * Whitepaper: "if baseFee increases, prompting the adjusted price curve to correct the execution costs"
   */
  async updateGasConditions(newBaseFee: number): Promise<void> {
    this.currentBaseFee = newBaseFee;

    for (const [orderHash, curveState] of this.curveStates) {
      if (!curveState.isActive) continue;

      await this.recalculateGasAdjustment(orderHash, newBaseFee);
    }

    this.logger.debug("Gas conditions updated", {
      newBaseFee: newBaseFee / 1e9, // Log in gwei
      activeOrders: this.curveStates.size,
    });
  }

  /**
   * Recalculate gas adjustment for a specific order
   * Implements both scenarios from Figure 3
   */
  private async recalculateGasAdjustment(
    orderHash: string,
    newBaseFee: number
  ): Promise<void> {
    const curveState = this.curveStates.get(orderHash);
    if (!curveState) return;

    // Get original base fee (when order was created)
    const originalBaseFee =
      curveState.gasAdjustments.length > 0
        ? curveState.gasAdjustments[0].originalBaseFee
        : this.currentBaseFee;

    // Calculate adjustment factor based on gas price change
    const gasRatio = newBaseFee / originalBaseFee;

    let adjustmentFactor: number;
    let adjustmentType: string;

    if (gasRatio > 1.0) {
      // Case 2: baseFee increased
      // "prompting the adjusted price curve to correct the execution costs"
      adjustmentFactor = gasRatio; // Increase rate to compensate for higher gas
      adjustmentType = "gas_increase_compensation";
    } else {
      // Case 1: baseFee declined
      // "the adjusted price curve reacted by increasing the number of tokens"
      adjustmentFactor = 1.0 + (1.0 - gasRatio) * 0.5; // Bonus for lower gas
      adjustmentType = "gas_decrease_bonus";
    }

    const adjustment: GasAdjustment = {
      orderHash,
      originalBaseFee,
      currentBaseFee: newBaseFee,
      adjustmentFactor,
      adjustedRate: 0, // Will be calculated when needed
      timestamp: Date.now(),
    };

    curveState.gasAdjustments.push(adjustment);

    this.logger.info("Gas adjustment calculated", {
      orderHash,
      adjustmentType,
      gasRatio: gasRatio.toFixed(3),
      adjustmentFactor: adjustmentFactor.toFixed(3),
      originalBaseFeeGwei: (originalBaseFee / 1e9).toFixed(2),
      newBaseFeeGwei: (newBaseFee / 1e9).toFixed(2),
    });

    this.emit("gas_adjustment", {
      orderHash,
      adjustment,
      adjustmentType,
    });
  }

  /**
   * Create default linear curve if no custom points provided
   */
  private createDefaultLinearCurve(): AuctionPoint[] {
    return [
      { delay: 0, coefficient: 1.0 }, // Start at 100%
      { delay: 30, coefficient: 0.75 }, // 75% at 30 seconds
      { delay: 60, coefficient: 0.5 }, // 50% at 60 seconds
      { delay: 90, coefficient: 0.25 }, // 25% at 90 seconds
      { delay: 120, coefficient: 0.0 }, // 0% at 120 seconds
    ];
  }

  /**
   * Start monitoring gas conditions
   */
  startGasMonitoring(intervalMs: number = 10000): void {
    if (this.gasMonitoringInterval) {
      clearInterval(this.gasMonitoringInterval);
    }

    this.gasMonitoringInterval = setInterval(async () => {
      // In production, fetch real gas price from network
      const mockBaseFee = this.generateMockGasPrice();
      await this.updateGasConditions(mockBaseFee);
    }, intervalMs);

    this.logger.info("Gas monitoring started", { intervalMs });
  }

  /**
   * Stop gas monitoring
   */
  stopGasMonitoring(): void {
    if (this.gasMonitoringInterval) {
      clearInterval(this.gasMonitoringInterval);
      this.gasMonitoringInterval = undefined;
    }
    this.logger.info("Gas monitoring stopped");
  }

  /**
   * Generate mock gas price for testing
   * In production, replace with actual network gas price fetching
   */
  private generateMockGasPrice(): number {
    // Simulate gas price volatility (±50% of current price)
    const volatility = 0.5;
    const change = (Math.random() - 0.5) * 2 * volatility;
    const newPrice = this.currentBaseFee * (1 + change);

    // Keep within reasonable bounds (5-100 gwei)
    return Math.max(5e9, Math.min(100e9, newPrice));
  }

  /**
   * Get curve state for an order
   */
  getCurveState(orderHash: string): CustomCurveState | undefined {
    return this.curveStates.get(orderHash);
  }

  /**
   * Deactivate curve when auction ends
   */
  deactivateCurve(orderHash: string): void {
    const curveState = this.curveStates.get(orderHash);
    if (curveState) {
      curveState.isActive = false;
      this.logger.debug("Curve deactivated", { orderHash });
    }
  }

  /**
   * Cleanup curve state
   */
  cleanupCurve(orderHash: string): void {
    this.curveStates.delete(orderHash);
    this.logger.debug("Curve state cleaned up", { orderHash });
  }

  /**
   * Get current gas adjustment summary for monitoring
   */
  getGasAdjustmentSummary(): {
    currentBaseFeeGwei: number;
    activeOrders: number;
    adjustmentsToday: number;
  } {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let adjustmentsToday = 0;
    for (const curveState of this.curveStates.values()) {
      adjustmentsToday += curveState.gasAdjustments.filter(
        adj => adj.timestamp > oneDayAgo
      ).length;
    }

    return {
      currentBaseFeeGwei: this.currentBaseFee / 1e9,
      activeOrders: this.curveStates.size,
      adjustmentsToday,
    };
  }
}
