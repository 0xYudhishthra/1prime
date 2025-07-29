import { EventEmitter } from "events";
import type { Logger } from "winston";
import { ChainAdapter, EscrowDetails, FusionOrder } from "../types";
import { ChainAdapterFactory } from "../adapters";
import { getChainConfig } from "../config/chains";
import { OneInchApiService } from "./1inch-api";

export interface EscrowVerificationResult {
  orderHash: string;
  sourceEscrow?: EscrowDetails;
  destinationEscrow?: EscrowDetails;
  isSourceVerified: boolean;
  isDestinationVerified: boolean;
  finalizationTime: number;
  error?: string;
}

export class EscrowVerifier extends EventEmitter {
  private logger: Logger;
  private oneInchApiService?: OneInchApiService;
  private adapters: Map<string, ChainAdapter> = new Map();
  private verificationInterval: number = 10000; // 10 seconds
  private activeVerifications: Set<string> = new Set();

  constructor(logger: Logger, oneInchApiService?: OneInchApiService) {
    super();
    this.logger = logger;
    this.oneInchApiService = oneInchApiService;
  }

  async initializeAdapters(
    chainIds: string[],
    privateKeys?: Record<string, string>
  ): Promise<void> {
    try {
      for (const chainId of chainIds) {
        const config = getChainConfig(chainId);
        const privateKey = privateKeys?.[chainId];
        const adapter = ChainAdapterFactory.createAdapter(
          config,
          this.logger,
          privateKey,
          this.oneInchApiService
        );
        this.adapters.set(chainId, adapter);

        // Verify contract deployments on initialization
        await this.verifyContractDeployments(chainId);
      }

      this.logger.info("Escrow verifier initialized", { chains: chainIds });
    } catch (error) {
      this.logger.error("Failed to initialize escrow verifier", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async verifyEscrowCreation(
    order: FusionOrder,
    resolver: string
  ): Promise<EscrowVerificationResult> {
    const result: EscrowVerificationResult = {
      orderHash: order.orderHash,
      isSourceVerified: false,
      isDestinationVerified: false,
      finalizationTime: 0,
    };

    try {
      this.activeVerifications.add(order.orderHash);

      // Get chain adapters
      const sourceAdapter = this.adapters.get(order.sourceChain);
      const destinationAdapter = this.adapters.get(order.destinationChain);

      if (!sourceAdapter || !destinationAdapter) {
        throw new Error(
          `Chain adapters not found for ${order.sourceChain} or ${order.destinationChain}`
        );
      }

      // Verify source chain escrow
      try {
        if (!order.sourceChainHtlcAddress) {
          throw new Error("Source chain HTLC address not set");
        }
        result.sourceEscrow = await sourceAdapter.verifyEscrow(
          order.orderHash,
          order.sourceChainHtlcAddress
        );
        result.isSourceVerified = this.validateEscrowDetails(
          result.sourceEscrow,
          order,
          resolver
        );
      } catch (error) {
        this.logger.warn("Source escrow verification failed", {
          orderHash: order.orderHash,
          error: (error as Error).message,
        });
      }

      // Verify destination chain escrow
      try {
        if (!order.destinationChainHtlcAddress) {
          throw new Error("Destination chain HTLC address not set");
        }
        result.destinationEscrow = await destinationAdapter.verifyEscrow(
          order.orderHash,
          order.destinationChainHtlcAddress
        );
        result.isDestinationVerified = this.validateEscrowDetails(
          result.destinationEscrow,
          order,
          resolver
        );
      } catch (error) {
        this.logger.warn("Destination escrow verification failed", {
          orderHash: order.orderHash,
          error: (error as Error).message,
        });
      }

      // Calculate finalization time
      if (result.isSourceVerified && result.isDestinationVerified) {
        result.finalizationTime = this.calculateFinalizationTime(
          order.sourceChain,
          order.destinationChain
        );

        this.logger.info("Both escrows verified", {
          orderHash: order.orderHash,
          finalizationTime: result.finalizationTime,
        });

        this.emit("escrows_verified", result);
      }

      return result;
    } catch (error) {
      result.error = (error as Error).message;
      this.logger.error("Escrow verification failed", {
        orderHash: order.orderHash,
        error: (error as Error).message,
      });

      this.emit("escrow_verification_failed", result);
      return result;
    } finally {
      this.activeVerifications.delete(order.orderHash);
    }
  }

  async monitorEscrowCreation(
    order: FusionOrder,
    resolver: string
  ): Promise<void> {
    const orderHash = order.orderHash;
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes with 10-second intervals

    const monitorInterval = setInterval(async () => {
      attempts++;

      try {
        const result = await this.verifyEscrowCreation(order, resolver);

        if (result.isSourceVerified && result.isDestinationVerified) {
          clearInterval(monitorInterval);
          this.logger.info("Escrow monitoring completed successfully", {
            orderHash,
          });
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(monitorInterval);
          this.logger.error("Escrow monitoring timed out", {
            orderHash,
            attempts,
          });
          this.emit("escrow_timeout", {
            orderHash,
            reason: "Monitoring timeout",
          });
          return;
        }

        this.logger.debug("Escrow monitoring in progress", {
          orderHash,
          attempts,
          sourceVerified: result.isSourceVerified,
          destinationVerified: result.isDestinationVerified,
        });
      } catch (error) {
        this.logger.error("Error during escrow monitoring", {
          orderHash,
          attempts,
          error: (error as Error).message,
        });
      }
    }, this.verificationInterval);
  }

  async checkContractDeployments(
    chainIds: string[]
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const chainId of chainIds) {
      results[chainId] = await this.verifyContractDeployments(chainId);
    }

    return results;
  }

  async checkBalances(
    addresses: string[],
    chainId: string,
    token?: string
  ): Promise<Record<string, string>> {
    const adapter = this.adapters.get(chainId);
    if (!adapter) {
      throw new Error(`Chain adapter not found for ${chainId}`);
    }

    const balances: Record<string, string> = {};

    for (const address of addresses) {
      try {
        balances[address] = await adapter.getBalance(address, token);
      } catch (error) {
        this.logger.error("Failed to check balance", {
          address,
          chainId,
          token,
          error: (error as Error).message,
        });
        balances[address] = "0";
      }
    }

    return balances;
  }

  async verifyFinality(
    orderHash: string,
    chainId: string,
    transactionHash: string
  ): Promise<boolean> {
    const adapter = this.adapters.get(chainId);
    if (!adapter) {
      throw new Error(`Chain adapter not found for ${chainId}`);
    }

    try {
      const config = getChainConfig(chainId);
      const currentBlock = await adapter.getBlockNumber();
      const tx = await adapter.getTransaction(transactionHash);

      if (!tx.receipt || !tx.receipt.blockNumber) {
        return false;
      }

      const confirmations = currentBlock - tx.receipt.blockNumber;
      const isFinalized = confirmations >= config.finalityBlocks;

      this.logger.debug("Finality check", {
        orderHash,
        chainId,
        transactionHash,
        confirmations,
        required: config.finalityBlocks,
        isFinalized,
      });

      return isFinalized;
    } catch (error) {
      this.logger.error("Finality verification failed", {
        orderHash,
        chainId,
        transactionHash,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async estimateGasCosts(
    operation: string,
    params: any,
    chainId: string
  ): Promise<{ gasLimit: number; estimatedCost: string }> {
    const adapter = this.adapters.get(chainId);
    if (!adapter) {
      throw new Error(`Chain adapter not found for ${chainId}`);
    }

    try {
      const gasLimit = await adapter.estimateGas(operation, params);

      // Simple gas cost estimation - in production this would use real gas price oracles
      const gasPrice = chainId === "near" ? 1e12 : 20e9; // 1 TGas for NEAR, 20 gwei for EVM
      const estimatedCost = (gasLimit * gasPrice).toString();

      return { gasLimit, estimatedCost };
    } catch (error) {
      this.logger.error("Gas estimation failed", {
        operation,
        chainId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  getActiveVerifications(): string[] {
    return Array.from(this.activeVerifications);
  }

  private async verifyContractDeployments(chainId: string): Promise<boolean> {
    const adapter = this.adapters.get(chainId);
    if (!adapter) {
      return false;
    }

    try {
      // In the per-swap HTLC architecture, contracts are deployed dynamically
      // by resolvers during Phase 2. No static contract verification needed.
      // Just verify that the adapter is properly initialized and chain is accessible.

      const blockNumber = await adapter.getBlockNumber();

      this.logger.info("Chain readiness verified", {
        chainId,
        currentBlock: blockNumber,
      });

      return true;
    } catch (error) {
      this.logger.error("Chain readiness check failed", {
        chainId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  private validateEscrowDetails(
    escrow: EscrowDetails,
    order: FusionOrder,
    resolver: string
  ): boolean {
    try {
      // Check if escrow exists
      if (!escrow.isCreated) {
        return false;
      }

      // Validate secret hash matches
      if (escrow.secretHash !== order.secretHash) {
        this.logger.warn("Secret hash mismatch", {
          orderHash: order.orderHash,
          expected: order.secretHash,
          actual: escrow.secretHash,
        });
        return false;
      }

      // Validate timeout
      if (Math.abs(escrow.timeout - order.timeout) > 300000) {
        // 5 minute tolerance
        this.logger.warn("Timeout mismatch", {
          orderHash: order.orderHash,
          expected: order.timeout,
          actual: escrow.timeout,
        });
        return false;
      }

      // Validate designated resolver
      if (escrow.designated.toLowerCase() !== resolver.toLowerCase()) {
        this.logger.warn("Resolver mismatch", {
          orderHash: order.orderHash,
          expected: resolver,
          actual: escrow.designated,
        });
        return false;
      }

      // Validate amount (allow for small differences due to precision)
      const expectedAmount =
        order.sourceChain === escrow.chain
          ? order.sourceAmount
          : order.destinationAmount;
      const amountDiff = Math.abs(
        parseFloat(escrow.amount) - parseFloat(expectedAmount)
      );
      const tolerance = parseFloat(expectedAmount) * 0.001; // 0.1% tolerance

      if (amountDiff > tolerance) {
        this.logger.warn("Amount mismatch", {
          orderHash: order.orderHash,
          expected: expectedAmount,
          actual: escrow.amount,
          difference: amountDiff,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Escrow validation failed", {
        orderHash: order.orderHash,
        error: (error as Error).message,
      });
      return false;
    }
  }

  private calculateFinalizationTime(
    sourceChain: string,
    destinationChain: string
  ): number {
    const sourceConfig = getChainConfig(sourceChain);
    const destinationConfig = getChainConfig(destinationChain);

    // Return the maximum finalization time between both chains
    const sourceFinalizationTime =
      sourceConfig.blockTime * sourceConfig.finalityBlocks * 1000;
    const destinationFinalizationTime =
      destinationConfig.blockTime * destinationConfig.finalityBlocks * 1000;

    return Math.max(sourceFinalizationTime, destinationFinalizationTime);
  }
}
