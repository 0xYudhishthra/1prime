import axios, { AxiosInstance } from "axios";
import type { Logger } from "winston";

export interface OneInchApiConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

export interface OneInchRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: any[];
  id: number;
}

export interface OneInchRpcResponse<T = any> {
  jsonrpc: "2.0";
  result: T;
  id: number;
}

export interface OneInchRpcError {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
  };
  id: number;
}

export class OneInchApiService {
  private client: AxiosInstance;
  private logger: Logger;
  private cache = new Map<
    string,
    { data: any; timestamp: number; ttl: number }
  >();
  private readonly CACHE_TTL = 30000; // 30 seconds default cache

  // Supported chain IDs for 1inch Web3 RPC API
  private readonly SUPPORTED_CHAINS = new Set([
    "1", // Ethereum
    "42161", // Arbitrum
    "43114", // Avalanche
    "8453", // Base
    "56", // Binance Smart Chain
    "324", // ZkSync
    "100", // Gnosis
    "10", // Optimism
  ]);

  constructor(config: OneInchApiConfig, logger: Logger) {
    this.logger = logger;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    // Add request/response interceptors for logging and error handling
    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      config => {
        this.logger.debug("1inch API Request", {
          method: config.method?.toUpperCase(),
          url: config.url,
          chainId: config.params?.chainId,
        });
        return config;
      },
      error => {
        this.logger.error("1inch API Request Error", { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      response => {
        this.logger.debug("1inch API Response", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      error => {
        this.logger.error("1inch API Response Error", {
          status: error.response?.status,
          message: error.response?.data?.message || error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Check if a chain is supported by 1inch Web3 RPC API
   */
  isChainSupported(chainId: string): boolean {
    return this.SUPPORTED_CHAINS.has(chainId);
  }

  /**
   * Make an RPC call to a specific chain using 1inch API
   * Optimized with caching for read operations
   * Throws error if chain is not supported
   */
  async rpcCall<T = any>(
    chainId: string,
    method: string,
    params: any[] = [],
    useCache: boolean = false
  ): Promise<T> {
    // Check if chain is supported by 1inch API
    if (!this.isChainSupported(chainId)) {
      throw new Error(
        `Chain ${chainId} is not supported by 1inch Web3 RPC API. Supported chains: ${Array.from(
          this.SUPPORTED_CHAINS
        ).join(", ")}`
      );
    }
    const cacheKey = `${chainId}:${method}:${JSON.stringify(params)}`;

    // Check cache for read operations
    if (useCache && this.isReadMethod(method)) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        this.logger.debug("1inch API Cache Hit", { method, chainId });
        return cached.data;
      }
    }

    const request: OneInchRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    };

    try {
      const response = await this.client.post<OneInchRpcResponse<T>>(
        `/${chainId}`,
        request
      );

      const result = response.data.result;

      // Cache read operations
      if (useCache && this.isReadMethod(method)) {
        this.cache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
          ttl: this.getCacheTTL(method),
        });
      }

      return result;
    } catch (error) {
      this.logger.error("1inch RPC Call Failed", {
        chainId,
        method,
        params,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Get block number with caching
   */
  async getBlockNumber(chainId: string): Promise<string> {
    return this.rpcCall<string>(chainId, "eth_blockNumber", [], true);
  }

  /**
   * Get balance with caching
   */
  async getBalance(
    chainId: string,
    address: string,
    block: string = "latest"
  ): Promise<string> {
    return this.rpcCall<string>(
      chainId,
      "eth_getBalance",
      [address, block],
      true
    );
  }

  /**
   * Get transaction receipt with caching
   */
  async getTransactionReceipt(chainId: string, txHash: string): Promise<any> {
    return this.rpcCall<any>(
      chainId,
      "eth_getTransactionReceipt",
      [txHash],
      true
    );
  }

  /**
   * Get transaction by hash with caching
   */
  async getTransactionByHash(chainId: string, txHash: string): Promise<any> {
    return this.rpcCall<any>(
      chainId,
      "eth_getTransactionByHash",
      [txHash],
      true
    );
  }

  /**
   * Get code at address with caching
   */
  async getCode(
    chainId: string,
    address: string,
    block: string = "latest"
  ): Promise<string> {
    return this.rpcCall<string>(chainId, "eth_getCode", [address, block], true);
  }

  /**
   * Call contract method (no caching for write operations)
   */
  async call(
    chainId: string,
    to: string,
    data: string,
    block: string = "latest"
  ): Promise<string> {
    return this.rpcCall<string>(
      chainId,
      "eth_call",
      [{ to, data }, block],
      false
    );
  }

  /**
   * Estimate gas (no caching)
   */
  async estimateGas(
    chainId: string,
    from: string,
    to: string,
    data: string
  ): Promise<string> {
    return this.rpcCall<string>(
      chainId,
      "eth_estimateGas",
      [{ from, to, data }],
      false
    );
  }

  /**
   * Send raw transaction (no caching)
   */
  async sendRawTransaction(chainId: string, signedTx: string): Promise<string> {
    return this.rpcCall<string>(
      chainId,
      "eth_sendRawTransaction",
      [signedTx],
      false
    );
  }

  /**
   * Get gas price with caching
   */
  async getGasPrice(chainId: string): Promise<string> {
    return this.rpcCall<string>(chainId, "eth_gasPrice", [], true);
  }

  /**
   * Get latest block with caching
   */
  async getLatestBlock(chainId: string): Promise<any> {
    return this.rpcCall<any>(
      chainId,
      "eth_getBlockByNumber",
      ["latest", false],
      true
    );
  }

  /**
   * Check if method is read-only (safe to cache)
   */
  private isReadMethod(method: string): boolean {
    const readMethods = [
      "eth_blockNumber",
      "eth_getBalance",
      "eth_getTransactionReceipt",
      "eth_getTransactionByHash",
      "eth_getCode",
      "eth_gasPrice",
      "eth_getBlockByNumber",
      "eth_getBlockByHash",
      "eth_getStorageAt",
      "eth_getLogs",
    ];
    return readMethods.includes(method);
  }

  /**
   * Get cache TTL based on method type
   */
  private getCacheTTL(method: string): number {
    switch (method) {
      case "eth_blockNumber":
      case "eth_gasPrice":
        return 5000; // 5 seconds for frequently changing data
      case "eth_getBalance":
        return 15000; // 15 seconds for balance checks
      case "eth_getTransactionReceipt":
      case "eth_getTransactionByHash":
        return 60000; // 1 minute for transaction data
      case "eth_getCode":
        return 300000; // 5 minutes for contract code
      default:
        return this.CACHE_TTL; // 30 seconds default
    }
  }

  /**
   * Clear cache for specific chain or all
   */
  clearCache(chainId?: string): void {
    if (chainId) {
      // Clear cache for specific chain
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${chainId}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
    }
    this.logger.debug("1inch API Cache Cleared", { chainId: chainId || "all" });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
