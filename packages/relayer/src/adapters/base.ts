import {
  ChainAdapter,
  ChainConfig,
  FusionOrder,
  EscrowDetails,
} from "../types";
import type { Logger } from "winston";

export abstract class BaseChainAdapter implements ChainAdapter {
  protected config: ChainConfig;
  protected logger: Logger;

  constructor(config: ChainConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  abstract getBalance(address: string, token?: string): Promise<string>;

  abstract checkContractDeployment(address: string): Promise<boolean>;

  abstract createEscrow(order: FusionOrder, resolver: string): Promise<string>;

  abstract verifyEscrow(
    orderHash: string,
    htlcContractAddress: string
  ): Promise<EscrowDetails>;

  abstract withdrawFromEscrow(
    orderHash: string,
    secret: string,
    htlcContractAddress: string
  ): Promise<string>;

  abstract cancelEscrow(
    orderHash: string,
    htlcContractAddress: string
  ): Promise<string>;

  abstract getBlockNumber(): Promise<number>;

  abstract getTransaction(hash: string): Promise<any>;

  abstract estimateGas(
    operation: string,
    params: any,
    htlcContractAddress?: string
  ): Promise<number>;

  protected logOperation(
    operation: string,
    params: any,
    result?: any,
    error?: Error
  ): void {
    const logData = {
      chain: this.config.name,
      operation,
      params,
      result: result ? "success" : undefined,
      error: error?.message,
      timestamp: Date.now(),
    };

    if (error) {
      this.logger.error(`Chain operation failed: ${operation}`, logData);
    } else {
      this.logger.info(`Chain operation completed: ${operation}`, logData);
    }
  }

  protected validateAddress(address: string): boolean {
    if (this.config.type === "evm") {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    } else if (this.config.type === "near") {
      return /^[a-zA-Z0-9_.-]+\.near$|^[a-f0-9]{64}$/.test(address);
    }
    return false;
  }

  protected calculateFinalizationTime(): number {
    return this.config.blockTime * this.config.finalityBlocks * 1000; // Convert to milliseconds
  }

  public getChainInfo() {
    return {
      chainId: this.config.chainId,
      name: this.config.name,
      type: this.config.type,
      blockTime: this.config.blockTime,
      finalityBlocks: this.config.finalityBlocks,
      // Note: HTLC contracts are deployed dynamically per swap
    };
  }
}
