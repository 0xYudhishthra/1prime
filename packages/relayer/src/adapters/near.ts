import * as nearAPI from "near-api-js";
import { BaseChainAdapter } from "./base";
import { ChainConfig, FusionOrder, EscrowDetails } from "../types";
import type { Logger } from "winston";

const { connect, keyStores, utils } = nearAPI;

export class NEARChainAdapter extends BaseChainAdapter {
  private connection?: nearAPI.Near;
  private account?: nearAPI.Account;
  private keyStore?: any;

  constructor(config: ChainConfig, logger: Logger, privateKey?: string) {
    super(config, logger);

    if (privateKey) {
      this.initializeConnection(privateKey);
    }
  }

  private async initializeConnection(privateKey?: string) {
    try {
      if (privateKey) {
        this.keyStore = new keyStores.InMemoryKeyStore();
        const keyPair = nearAPI.utils.KeyPair.fromString(privateKey);
        await this.keyStore.setKey(this.config.chainId, "1prime.near", keyPair);
      } else {
        this.keyStore = new keyStores.InMemoryKeyStore();
      }

      const connectionConfig = {
        networkId: this.config.chainId,
        keyStore: this.keyStore,
        nodeUrl: this.config.rpcUrl,
        walletUrl:
          this.config.chainId === "mainnet"
            ? "https://wallet.mainnet.near.org"
            : "https://wallet.testnet.near.org",
        helperUrl:
          this.config.chainId === "mainnet"
            ? "https://helper.mainnet.near.org"
            : "https://helper.testnet.near.org",
      };

      this.connection = await connect(connectionConfig);

      if (privateKey) {
        this.account = await this.connection.account("1prime.near");
      }

      this.logger.info("NEAR connection initialized", {
        chainId: this.config.chainId,
      });
    } catch (error) {
      this.logger.error("Failed to initialize NEAR connection", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getBalance(address: string, token?: string): Promise<string> {
    try {
      if (!this.validateAddress(address)) {
        throw new Error(`Invalid NEAR address: ${address}`);
      }

      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(address);

      let balance: string;

      if (token && token !== "NEAR") {
        // For fungible tokens, call ft_balance_of
        const result = await account.viewFunction({
          contractId: token,
          methodName: "ft_balance_of",
          args: { account_id: address },
        });
        balance = result;
      } else {
        // For NEAR tokens
        const accountState = await account.state();
        balance = accountState.amount;
      }

      this.logOperation("getBalance", { address, token }, balance);
      return balance;
    } catch (error) {
      this.logOperation(
        "getBalance",
        { address, token },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async checkContractDeployment(address: string): Promise<boolean> {
    try {
      if (!this.validateAddress(address)) {
        return false;
      }

      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(address);
      const state = await account.state();

      const isDeployed = state.code_hash !== "11111111111111111111111111111111";

      this.logOperation("checkContractDeployment", { address }, isDeployed);
      return isDeployed;
    } catch (error) {
      this.logOperation(
        "checkContractDeployment",
        { address },
        undefined,
        error as Error
      );
      return false;
    }
  }

  async createEscrow(order: FusionOrder, resolver: string): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      if (!this.validateAddress(resolver)) {
        throw new Error(`Invalid resolver address: ${resolver}`);
      }

      const amount = utils.format.parseNearAmount(order.sourceAmount);
      if (!amount) {
        throw new Error(`Invalid amount: ${order.sourceAmount}`);
      }

      // Skip escrow creation - using simplified flow
      this.logger.info("Skipping escrow creation - simplified flow", {
        orderHash: order.orderHash,
        chain: this.config.chainId,
        resolver,
      });

      // Return order hash as transaction reference for simplified flow
      const txReference = `skip_${order.orderHash}_near`;

      this.logOperation(
        "createEscrow",
        { orderHash: order.orderHash, resolver, status: "skipped" },
        txReference
      );

      return txReference;
    } catch (error) {
      this.logOperation(
        "createEscrow",
        { orderHash: order.orderHash, resolver },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async verifyEscrow(
    orderHash: string,
    escrowAddress: string
  ): Promise<EscrowDetails> {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      // Simplified escrow verification - just check if contract exists
      const account = await this.connection!.account(escrowAddress);

      try {
        const state = await account.state();
        const isDeployed =
          state.code_hash !== "11111111111111111111111111111111"; // Default empty account hash

        const escrowDetails: EscrowDetails = {
          orderHash,
          chain: this.config.name,
          contractAddress: escrowAddress,
          secretHash: "", // Would need to query from actual escrow contract
          amount: "0", // Would need to query from actual escrow contract
          timeout: 0, // Would need to query from actual escrow contract
          creator: "", // Would need to query from actual escrow contract
          designated: "", // Would need to query from actual escrow contract
          isCreated: isDeployed,
          isWithdrawn: false, // Would need to query from actual escrow contract
          isCancelled: false, // Would need to query from actual escrow contract
          createdAt: Date.now(), // Placeholder
        };

        this.logOperation(
          "verifyEscrow",
          { orderHash, escrowAddress },
          escrowDetails
        );
        return escrowDetails;
      } catch {
        // Account doesn't exist
        const escrowDetails: EscrowDetails = {
          orderHash,
          chain: this.config.name,
          contractAddress: escrowAddress,
          secretHash: "",
          amount: "0",
          timeout: 0,
          creator: "",
          designated: "",
          isCreated: false,
          isWithdrawn: false,
          isCancelled: false,
          createdAt: Date.now(),
        };

        this.logOperation(
          "verifyEscrow",
          { orderHash, escrowAddress },
          escrowDetails
        );
        return escrowDetails;
      }
    } catch (error) {
      this.logOperation(
        "verifyEscrow",
        { orderHash, escrowAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async withdrawFromEscrow(
    orderHash: string,
    secret: string,
    escrowAddress: string
  ): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      // Placeholder for escrow withdrawal - would need actual escrow contract methods
      this.logger.info("Escrow withdrawal requested", {
        orderHash,
        escrowAddress,
        hasSecret: !!secret,
      });

      // For now, return a mock transaction hash
      const mockTxHash = `${Math.random().toString(16).substr(2, 64)}`;

      this.logOperation(
        "withdrawFromEscrow",
        { orderHash, escrowAddress },
        mockTxHash
      );
      return mockTxHash;
    } catch (error) {
      this.logOperation(
        "withdrawFromEscrow",
        { orderHash, escrowAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async cancelEscrow(
    orderHash: string,
    escrowAddress: string
  ): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      // Placeholder for escrow cancellation - would need actual escrow contract methods
      this.logger.info("Escrow cancellation requested", {
        orderHash,
        escrowAddress,
      });

      // For now, return a mock transaction hash
      const mockTxHash = `${Math.random().toString(16).substr(2, 64)}`;

      this.logOperation(
        "cancelEscrow",
        { orderHash, escrowAddress },
        mockTxHash
      );
      return mockTxHash;
    } catch (error) {
      this.logOperation(
        "cancelEscrow",
        { orderHash, escrowAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async getBlockNumber(): Promise<number> {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const status = await this.connection!.connection.provider.status();
      const blockHeight = status.sync_info.latest_block_height;

      this.logOperation("getBlockNumber", {}, blockHeight);
      return blockHeight;
    } catch (error) {
      this.logOperation("getBlockNumber", {}, undefined, error as Error);
      throw error;
    }
  }

  async getTransaction(hash: string): Promise<any> {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const result = await this.connection!.connection.provider.txStatus(
        hash,
        "relayer-account.near"
      );

      this.logOperation("getTransaction", { hash }, result);
      return result;
    } catch (error) {
      this.logOperation("getTransaction", { hash }, undefined, error as Error);
      throw error;
    }
  }

  async estimateGas(
    operation: string,
    params: any,
    escrowAddress?: string
  ): Promise<number> {
    try {
      let gasEstimate: number;

      // NEAR gas estimation is based on operation type, not contract address
      switch (operation) {
        case "createEscrow":
          gasEstimate = this.config.gasLimit.withdrawal; // Use withdrawal as default
          break;
        case "withdraw":
          gasEstimate = this.config.gasLimit.withdrawal;
          break;
        case "cancel":
          gasEstimate = this.config.gasLimit.cancellation;
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      this.logOperation(
        "estimateGas",
        { operation, params, escrowAddress },
        gasEstimate
      );
      return gasEstimate;
    } catch (error) {
      this.logOperation(
        "estimateGas",
        { operation, params, escrowAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  private formatNearAmount(amount: string): string {
    return utils.format.formatNearAmount(amount);
  }

  private parseNearAmount(amount: string): string | null {
    return utils.format.parseNearAmount(amount);
  }
}
