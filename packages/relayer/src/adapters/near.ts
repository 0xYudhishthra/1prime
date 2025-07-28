import * as nearAPI from "near-api-js";
import { BaseChainAdapter } from "./base";
import { ChainConfig, FusionOrder, EscrowDetails } from "../types";
import type { Logger } from "winston";

const { connect, keyStores, utils } = nearAPI;

export class NEARChainAdapter extends BaseChainAdapter {
  private connection?: nearAPI.Near;
  private account?: nearAPI.Account;
  private keyStore?: nearAPI.KeyStore;

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
        const result = await account.viewFunction(token, "ft_balance_of", {
          account_id: address,
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

      const outcome = await this.account.functionCall({
        contractId: this.config.contractAddresses.htlc,
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

  async verifyEscrow(orderHash: string): Promise<EscrowDetails> {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(
        this.config.contractAddresses.htlc
      );

      const htlcDetails = await account.viewFunction(
        this.config.contractAddresses.htlc,
        "get_htlc_details",
        { order_hash: orderHash }
      );

      const escrowDetails: EscrowDetails = {
        orderHash,
        chain: this.config.name,
        contractAddress: this.config.contractAddresses.htlc,
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

      this.logOperation("verifyEscrow", { orderHash }, escrowDetails);
      return escrowDetails;
    } catch (error) {
      this.logOperation(
        "verifyEscrow",
        { orderHash },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async withdrawFromEscrow(orderHash: string, secret: string): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      const outcome = await this.account.functionCall({
        contractId: this.config.contractAddresses.htlc,
        methodName: "claim_htlc",
        args: {
          order_hash: orderHash,
          secret: secret,
        },
        gas: this.config.gasLimit.withdrawal.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation("withdrawFromEscrow", { orderHash }, transactionHash);
      return transactionHash;
    } catch (error) {
      this.logOperation(
        "withdrawFromEscrow",
        { orderHash },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async cancelEscrow(orderHash: string): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      const outcome = await this.account.functionCall({
        contractId: this.config.contractAddresses.htlc,
        methodName: "refund_htlc",
        args: {
          order_hash: orderHash,
        },
        gas: this.config.gasLimit.cancellation.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation("cancelEscrow", { orderHash }, transactionHash);
      return transactionHash;
    } catch (error) {
      this.logOperation(
        "cancelEscrow",
        { orderHash },
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

  async estimateGas(operation: string, params: any): Promise<number> {
    try {
      let gasEstimate: number;

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

  async getOrderDetails(orderHash: string) {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(
        this.config.contractAddresses.turnstile
      );

      const orderDetails = await account.viewFunction(
        this.config.contractAddresses.turnstile,
        "get_order",
        { order_hash: orderHash }
      );

      return {
        secretHash: orderDetails.secret_hash,
        timeout: parseInt(orderDetails.timeout),
        user: orderDetails.user,
        amount: orderDetails.amount,
        initialRateBump: parseInt(orderDetails.initial_rate_bump),
        auctionDuration: parseInt(orderDetails.auction_duration),
        priceOracle: orderDetails.price_oracle,
        minBondTier: parseInt(orderDetails.min_bond_tier),
        requireBondHistory: orderDetails.require_bond_history,
        fulfilled: orderDetails.fulfilled,
        designatedRelayer: orderDetails.designated_relayer,
      };
    } catch (error) {
      this.logOperation(
        "getOrderDetails",
        { orderHash },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async getRelayerBond(relayer: string) {
    try {
      if (!this.connection) {
        await this.initializeConnection();
      }

      const account = await this.connection!.account(
        this.config.contractAddresses.turnstile
      );

      const bondInfo = await account.viewFunction(
        this.config.contractAddresses.turnstile,
        "get_relayer_bond",
        { relayer }
      );

      return {
        totalBond: bondInfo.total_bond,
        activeBond: bondInfo.active_bond,
        withdrawalRequest: bondInfo.withdrawal_request,
        withdrawalDeadline: parseInt(bondInfo.withdrawal_deadline),
        challengePeriodActive: bondInfo.challenge_period_active,
        bondedSince: parseInt(bondInfo.bonded_since),
        slashingHistory: parseInt(bondInfo.slashing_history),
      };
    } catch (error) {
      this.logOperation(
        "getRelayerBond",
        { relayer },
        undefined,
        error as Error
      );
      throw error;
    }
  }

  async markOrderFulfilled(
    orderHash: string,
    secret: string,
    relayer: string
  ): Promise<string> {
    if (!this.account) {
      throw new Error("NEAR account not configured for transaction signing");
    }

    try {
      const outcome = await this.account.functionCall({
        contractId: this.config.contractAddresses.fulfillment,
        methodName: "mark_near_claimed",
        args: {
          order_hash: orderHash,
          secret: secret,
          relayer: relayer,
        },
        gas: this.config.gasLimit.withdrawal.toString(),
      });

      const transactionHash = outcome.transaction.hash;

      this.logOperation(
        "markOrderFulfilled",
        { orderHash, relayer },
        transactionHash
      );
      return transactionHash;
    } catch (error) {
      this.logOperation(
        "markOrderFulfilled",
        { orderHash, relayer },
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
