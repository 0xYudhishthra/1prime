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
        await this.keyStore.setKey(
          this.config.chainId,
          "relayer-account.near",
          keyPair
        );
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
        this.account = await this.connection.account("relayer-account.near");
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

      // HTLC contract address should be provided in the order
      let htlcContractAddress: string;
      if (this.config.chainId === order.sourceChain) {
        htlcContractAddress = order.sourceChainHtlcAddress || "";
      } else {
        htlcContractAddress = order.destinationChainHtlcAddress || "";
      }

      if (!htlcContractAddress) {
        throw new Error(
          `HTLC contract address not set for chain ${this.config.chainId}`
        );
      }

      const outcome = await this.account.functionCall({
        contractId: htlcContractAddress,
        methodName: "create_htlc",
        args: {
          secret_hash: order.secretHash,
          timeout: order.timeout.toString(),
          designated_relayer: resolver,
          order_hash: order.orderHash,
        },
        attachedDeposit: amount,
        gas: this.config.gasLimit.htlcCreation.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation(
        "createEscrow",
        { orderHash: order.orderHash, resolver },
        transactionHash
      );
      return transactionHash;
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
    htlcContractAddress: string
  ): Promise<EscrowDetails> {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(htlcContractAddress);

      const htlcDetails = await account.viewFunction({
        contractId: htlcContractAddress,
        methodName: "get_htlc_details",
        args: { order_hash: orderHash },
      });

      const escrowDetails: EscrowDetails = {
        orderHash,
        chain: this.config.name,
        contractAddress: htlcContractAddress,
        secretHash: htlcDetails.secret_hash,
        amount: htlcDetails.amount,
        timeout: parseInt(htlcDetails.timeout),
        creator: htlcDetails.creator,
        designated: htlcDetails.designated_relayer,
        isCreated: htlcDetails.amount !== "0",
        isWithdrawn: htlcDetails.claimed,
        isCancelled: htlcDetails.refunded,
        createdAt: parseInt(htlcDetails.created_at),
      };

      this.logOperation(
        "verifyEscrow",
        { orderHash, htlcContractAddress },
        escrowDetails
      );
      return escrowDetails;
    } catch (error) {
      this.logOperation(
        "verifyEscrow",
        { orderHash, htlcContractAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async withdrawFromEscrow(
    orderHash: string,
    secret: string,
    htlcContractAddress: string
  ): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      const outcome = await this.account.functionCall({
        contractId: htlcContractAddress,
        methodName: "claim_htlc",
        args: {
          order_hash: orderHash,
          secret: secret,
        },
        gas: this.config.gasLimit.withdrawal.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation(
        "withdrawFromEscrow",
        { orderHash, htlcContractAddress },
        transactionHash
      );
      return transactionHash;
    } catch (error) {
      this.logOperation(
        "withdrawFromEscrow",
        { orderHash, htlcContractAddress },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async cancelEscrow(
    orderHash: string,
    htlcContractAddress: string
  ): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      const outcome = await this.account.functionCall({
        contractId: htlcContractAddress,
        methodName: "refund_htlc",
        args: {
          order_hash: orderHash,
        },
        gas: this.config.gasLimit.cancellation.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation(
        "cancelEscrow",
        { orderHash, htlcContractAddress },
        transactionHash
      );
      return transactionHash;
    } catch (error) {
      this.logOperation(
        "cancelEscrow",
        { orderHash, htlcContractAddress },
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
    htlcContractAddress?: string
  ): Promise<number> {
    try {
      let gasEstimate: number;

      // NEAR gas estimation is based on operation type, not contract address
      switch (operation) {
        case "createEscrow":
          gasEstimate = this.config.gasLimit.htlcCreation;
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

      this.logOperation("estimateGas", { operation, params }, gasEstimate);
      return gasEstimate;
    } catch (error) {
      this.logOperation(
        "estimateGas",
        { operation, params },
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
