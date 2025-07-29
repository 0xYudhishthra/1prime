import { ChainAdapter, ChainConfig } from "../types";
import { BaseChainAdapter } from "./base";
import { EVMChainAdapter } from "./evm";
import { NEARChainAdapter } from "./near";
import type { Logger } from "winston";
import { OneInchApiService } from "../services/1inch-api";

export { BaseChainAdapter } from "./base";
export { EVMChainAdapter } from "./evm";
export { NEARChainAdapter } from "./near";

export class ChainAdapterFactory {
  private static adapters: Map<string, ChainAdapter> = new Map();

  static createAdapter(
    config: ChainConfig,
    logger: Logger,
    privateKey?: string,
    oneInchApi?: OneInchApiService
  ): ChainAdapter {
    const key = `${config.chainId}-${config.type}`;

    if (this.adapters.has(key)) {
      return this.adapters.get(key)!;
    }

    let adapter: ChainAdapter;

    switch (config.type) {
      case "evm":
        adapter = new EVMChainAdapter(config, logger, privateKey, oneInchApi);
        break;
      case "near":
        adapter = new NEARChainAdapter(config, logger, privateKey);
        break;
      default:
        throw new Error(`Unsupported chain type: ${config.type}`);
    }

    this.adapters.set(key, adapter);
    logger.info(`Created chain adapter`, {
      chainId: config.chainId,
      type: config.type,
      name: config.name,
    });

    return adapter;
  }

  static getAdapter(
    chainId: string,
    chainType: "evm" | "near"
  ): ChainAdapter | undefined {
    const key = `${chainId}-${chainType}`;
    return this.adapters.get(key);
  }

  static getAllAdapters(): ChainAdapter[] {
    return Array.from(this.adapters.values());
  }

  static clearAdapters(): void {
    this.adapters.clear();
  }

  static hasAdapter(chainId: string, chainType: "evm" | "near"): boolean {
    const key = `${chainId}-${chainType}`;
    return this.adapters.has(key);
  }

  static removeAdapter(chainId: string, chainType: "evm" | "near"): boolean {
    const key = `${chainId}-${chainType}`;
    return this.adapters.delete(key);
  }
}
