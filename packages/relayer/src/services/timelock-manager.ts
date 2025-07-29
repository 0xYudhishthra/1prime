import { EventEmitter } from "events";
import type { Logger } from "winston";
import * as cron from "node-cron";
import { TimelockPhase, FusionOrder, OrderStatus } from "../types";
import { getChainConfig } from "../config/chains";

export interface TimelockConfig {
  finalizationTime: number;
  exclusiveWithdrawTime: number;
  cancellationTime: number;
  recoveryTime: number;
}

export interface TimelockEvent {
  orderHash: string;
  phase: TimelockPhase["phase"];
  timestamp: number;
  nextPhase?: TimelockPhase["phase"];
  timeRemaining?: number;
}

export class TimelockManager extends EventEmitter {
  private logger: Logger;
  private timelocks: Map<string, TimelockPhase> = new Map();
  private timelockConfigs: Map<string, TimelockConfig> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private cronJob?: cron.ScheduledTask;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    // Start monitoring timelocks every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.monitorTimelocks();
    }, 30000);

    // Start cron job for precise timing checks every minute
    this.cronJob = cron.schedule(
      "* * * * *",
      () => {
        this.checkCriticalTimelocks();
      },
      { scheduled: false }
    );

    this.cronJob.start();

    this.logger.info("Timelock manager initialized");
  }

  async setupOrderTimelocks(order: FusionOrder): Promise<void> {
    try {
      const config = this.calculateTimelockConfig(order);
      this.timelockConfigs.set(order.orderHash, config);

      // Initialize announcement phase
      const announcementPhase: TimelockPhase = {
        phase: "announcement",
        orderHash: order.orderHash,
        startTime: order.auctionStartTime,
        endTime: order.auctionStartTime + order.auctionDuration,
        isActive: true,
        nextPhase: "deposit",
      };

      this.timelocks.set(order.orderHash, announcementPhase);

      this.logger.info("Order timelocks setup", {
        orderHash: order.orderHash,
        config,
      });

      this.emit("timelock_setup", {
        orderHash: order.orderHash,
        phase: "announcement",
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error("Failed to setup order timelocks", {
        orderHash: order.orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async transitionToDepositPhase(
    orderHash: string,
    resolver: string
  ): Promise<void> {
    const timelock = this.timelocks.get(orderHash);
    const config = this.timelockConfigs.get(orderHash);

    if (!timelock || !config) {
      throw new Error(`Timelock not found for order: ${orderHash}`);
    }

    if (timelock.phase !== "announcement") {
      throw new Error(
        `Invalid phase transition from ${timelock.phase} to deposit`
      );
    }

    const now = Date.now();
    const depositPhase: TimelockPhase = {
      phase: "deposit",
      orderHash,
      startTime: now,
      endTime: now + config.finalizationTime,
      isActive: true,
      nextPhase: "withdrawal",
    };

    // Deactivate previous phase
    timelock.isActive = false;

    // Set new phase
    this.timelocks.set(orderHash, depositPhase);

    this.logger.info("Transitioned to deposit phase", {
      orderHash,
      resolver,
      finalizationEndTime: new Date(depositPhase.endTime),
    });

    this.emit("phase_transition", {
      orderHash,
      phase: "deposit",
      timestamp: now,
      nextPhase: "withdrawal",
      timeRemaining: config.finalizationTime,
    });
  }

  async transitionToWithdrawalPhase(orderHash: string): Promise<void> {
    const timelock = this.timelocks.get(orderHash);
    const config = this.timelockConfigs.get(orderHash);

    if (!timelock || !config) {
      throw new Error(`Timelock not found for order: ${orderHash}`);
    }

    if (timelock.phase !== "deposit") {
      throw new Error(
        `Invalid phase transition from ${timelock.phase} to withdrawal`
      );
    }

    const now = Date.now();
    const withdrawalPhase: TimelockPhase = {
      phase: "withdrawal",
      orderHash,
      startTime: now,
      endTime: now + config.exclusiveWithdrawTime + config.cancellationTime,
      isActive: true,
      nextPhase: "recovery",
    };

    // Deactivate previous phase
    timelock.isActive = false;

    // Set new phase
    this.timelocks.set(orderHash, withdrawalPhase);

    this.logger.info("Transitioned to withdrawal phase", {
      orderHash,
      exclusiveEndTime: new Date(now + config.exclusiveWithdrawTime),
      totalEndTime: new Date(withdrawalPhase.endTime),
    });

    this.emit("phase_transition", {
      orderHash,
      phase: "withdrawal",
      timestamp: now,
      nextPhase: "recovery",
      timeRemaining: config.exclusiveWithdrawTime + config.cancellationTime,
    });

    // Schedule exclusive withdrawal end
    setTimeout(() => {
      this.emit("exclusive_withdrawal_ended", {
        orderHash,
        timestamp: Date.now(),
      });
    }, config.exclusiveWithdrawTime);
  }

  async transitionToRecoveryPhase(
    orderHash: string,
    reason: string
  ): Promise<void> {
    const timelock = this.timelocks.get(orderHash);
    const config = this.timelockConfigs.get(orderHash);

    if (!timelock || !config) {
      throw new Error(`Timelock not found for order: ${orderHash}`);
    }

    const now = Date.now();
    const recoveryPhase: TimelockPhase = {
      phase: "recovery",
      orderHash,
      startTime: now,
      endTime: now + config.recoveryTime,
      isActive: true,
    };

    // Deactivate previous phase
    timelock.isActive = false;

    // Set new phase
    this.timelocks.set(orderHash, recoveryPhase);

    this.logger.info("Transitioned to recovery phase", {
      orderHash,
      reason,
      recoveryEndTime: new Date(recoveryPhase.endTime),
    });

    this.emit("phase_transition", {
      orderHash,
      phase: "recovery",
      timestamp: now,
      timeRemaining: config.recoveryTime,
    });
  }

  async completeOrder(orderHash: string): Promise<void> {
    const timelock = this.timelocks.get(orderHash);
    if (timelock) {
      timelock.isActive = false;
      this.timelocks.delete(orderHash);
      this.timelockConfigs.delete(orderHash);

      this.logger.info("Order timelock completed", { orderHash });
      this.emit("order_completed", { orderHash, timestamp: Date.now() });
    }
  }

  getTimelockPhase(orderHash: string): TimelockPhase | undefined {
    return this.timelocks.get(orderHash);
  }

  getTimelockConfig(orderHash: string): TimelockConfig | undefined {
    return this.timelockConfigs.get(orderHash);
  }

  isPhaseActive(orderHash: string, phase: TimelockPhase["phase"]): boolean {
    const timelock = this.timelocks.get(orderHash);
    return timelock?.phase === phase && timelock.isActive;
  }

  getTimeRemaining(orderHash: string): number {
    const timelock = this.timelocks.get(orderHash);
    if (!timelock || !timelock.isActive) {
      return 0;
    }

    return Math.max(0, timelock.endTime - Date.now());
  }

  isExclusiveWithdrawalActive(orderHash: string): boolean {
    const timelock = this.timelocks.get(orderHash);
    const config = this.timelockConfigs.get(orderHash);

    if (!timelock || !config || timelock.phase !== "withdrawal") {
      return false;
    }

    const timeSinceWithdrawalStart = Date.now() - timelock.startTime;
    return timeSinceWithdrawalStart < config.exclusiveWithdrawTime;
  }

  getActiveTimelocks(): TimelockPhase[] {
    return Array.from(this.timelocks.values()).filter(
      timelock => timelock.isActive
    );
  }

  private monitorTimelocks(): void {
    const now = Date.now();

    for (const [orderHash, timelock] of this.timelocks.entries()) {
      if (!timelock.isActive) {
        continue;
      }

      // Check if phase has expired
      if (now >= timelock.endTime) {
        this.handlePhaseExpiration(orderHash, timelock);
      }

      // Check for upcoming transitions (warn 5 minutes before)
      const timeRemaining = timelock.endTime - now;
      if (timeRemaining <= 300000 && timeRemaining > 270000) {
        // 5 minutes warning window
        this.emit("phase_expiring_soon", {
          orderHash,
          phase: timelock.phase,
          timestamp: now,
          timeRemaining,
        });
      }
    }
  }

  private checkCriticalTimelocks(): void {
    const now = Date.now();

    for (const [orderHash, timelock] of this.timelocks.entries()) {
      if (!timelock.isActive) {
        continue;
      }

      // Critical check for withdrawal phase
      if (timelock.phase === "withdrawal") {
        const config = this.timelockConfigs.get(orderHash);
        if (config) {
          const exclusiveEndTime =
            timelock.startTime + config.exclusiveWithdrawTime;

          // Check if exclusive withdrawal period just ended
          if (now >= exclusiveEndTime && now < exclusiveEndTime + 60000) {
            // 1 minute window
            this.emit("exclusive_withdrawal_ended", {
              orderHash,
              timestamp: now,
            });
          }
        }
      }
    }
  }

  private handlePhaseExpiration(
    orderHash: string,
    timelock: TimelockPhase
  ): void {
    switch (timelock.phase) {
      case "announcement":
        // Auction expired - transition to recovery if no winner
        this.logger.warn("Announcement phase expired", { orderHash });
        this.transitionToRecoveryPhase(
          orderHash,
          "Auction expired without winner"
        );
        break;

      case "deposit":
        // Finalization time reached - can transition to withdrawal
        this.logger.info("Deposit phase finalization completed", { orderHash });
        this.emit("finalization_completed", {
          orderHash,
          timestamp: Date.now(),
        });
        break;

      case "withdrawal":
        // Withdrawal period expired - transition to recovery
        this.logger.warn("Withdrawal phase expired", { orderHash });
        this.transitionToRecoveryPhase(orderHash, "Withdrawal timeout");
        break;

      case "recovery":
        // Recovery period ended - order should be cleaned up
        this.logger.info("Recovery phase completed", { orderHash });
        this.completeOrder(orderHash);
        break;
    }
  }

  private calculateTimelockConfig(order: FusionOrder): TimelockConfig {
    const sourceConfig = getChainConfig(order.sourceChain);
    const destinationConfig = getChainConfig(order.destinationChain);

    // Calculate finalization time based on both chains
    const sourceFinalizationTime =
      sourceConfig.blockTime * sourceConfig.finalityBlocks * 1000;
    const destinationFinalizationTime =
      destinationConfig.blockTime * destinationConfig.finalityBlocks * 1000;
    const finalizationTime = Math.max(
      sourceFinalizationTime,
      destinationFinalizationTime
    );

    // Standard timelock periods based on 1inch Fusion+ specifications
    return {
      finalizationTime, // Finality lock period
      exclusiveWithdrawTime: 300000, // 5 minutes exclusive withdrawal for winning resolver
      cancellationTime: 1800000, // 30 minutes for general cancellation
      recoveryTime: 3600000, // 1 hour recovery period
    };
  }

  /**
   * Start monitoring for a specific order (called when SDK orders are created)
   */
  async startMonitoring(orderHash: string): Promise<void> {
    this.logger.info("Started timelock monitoring for SDK order", {
      orderHash,
    });

    // The actual monitoring happens in the existing monitorTimelocks() method
    // which runs every 30 seconds and checks all orders
    // This method exists for API compatibility
  }

  cleanup(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.cronJob) {
      this.cronJob.stop();
    }

    this.timelocks.clear();
    this.timelockConfigs.clear();

    this.logger.info("Timelock manager cleanup completed");
  }
}
