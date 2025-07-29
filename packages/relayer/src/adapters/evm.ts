import { ethers, Contract, Provider, Wallet } from "ethers";
import { BaseChainAdapter } from "./base";
import { ChainConfig, FusionOrder, EscrowDetails } from "../types";
import type { Logger } from "winston";

const HTLC_ABI = [
  "function createHTLC(bytes32 secretHash, uint256 timeout, address designatedRelayer, string nearOrderHash) external payable returns (bytes32)",
  "function claimHTLC(bytes32 htlcId, bytes32 secret) external",
  "function refundHTLC(bytes32 htlcId) external",
  "function htlcs(bytes32) view returns (bytes32 secretHash, uint256 amount, uint256 timeout, address user, address designatedRelayer, bool claimed, bool refunded, uint256 createdAt, string nearOrderHash)",
  "function getHTLCDetails(bytes32 htlcId) view returns (tuple(bytes32 secretHash, uint256 amount, uint256 timeout, address user, address designatedRelayer, bool claimed, bool refunded, uint256 createdAt, string nearOrderHash))",
];

const TURNSTILE_ABI = [
  "function createOrder(bytes32 secretHash, uint256 timeout, address user, uint256 amount, uint256 initialRateBump, uint256 auctionDuration, address priceOracle, uint256 minBondTier, bool requireBondHistory) external returns (bytes32)",
  "function orders(bytes32) view returns (bytes32 secretHash, uint256 timeout, address user, uint256 amount, uint256 initialRateBump, uint256 auctionDuration, address priceOracle, uint256 minBondTier, bool requireBondHistory, bool fulfilled, address designatedRelayer)",
  "function releaseBond(address relayer, bytes32 orderHash) external",
  "function relayerBonds(address) view returns (uint256 totalBond, uint256 activeBond, uint256 withdrawalRequest, uint256 withdrawalDeadline, bool challengePeriodActive, uint256 bondedSince, uint256 slashingHistory)",
];

const FULFILLMENT_ABI = [
  "function markETHClaimed(bytes32 orderHash, bytes32 secret, address relayer) external",
  "function verifyNEARFulfillment(bytes32 orderHash, bytes32 secret, address relayer, bytes32 transactionHash) external",
  "function completedOrders(bytes32) view returns (bool)",
  "function revealedSecrets(bytes32) view returns (bytes32)",
  "function fulfillmentProofs(bytes32) view returns (bytes32 orderHash, bytes32 secretRevealed, uint256 timestamp, address relayer, string sourceChain, bytes32 transactionHash, bool verified)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export class EVMChainAdapter extends BaseChainAdapter {
  private provider!: Provider;
  private wallet?: Wallet;

  constructor(config: ChainConfig, logger: Logger, privateKey?: string) {
    super(config, logger);

    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
  }

  // Create HTLC contract instance dynamically with given address
  private getHTLCContract(contractAddress: string): Contract {
    return new ethers.Contract(
      contractAddress,
      HTLC_ABI,
      this.wallet || this.provider
    );
  }

  async getBalance(address: string, token?: string): Promise<string> {
    try {
      if (!this.validateAddress(address)) {
        throw new Error(`Invalid address: ${address}`);
      }

      let balance: bigint;

      if (token && token !== "ETH") {
        const tokenContract = new ethers.Contract(
          token,
          ERC20_ABI,
          this.provider
        );
        balance = await tokenContract.balanceOf(address);
      } else {
        balance = await this.provider.getBalance(address);
      }

      this.logOperation("getBalance", { address, token }, balance.toString());
      return balance.toString();
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

      const code = await this.provider.getCode(address);
      const isDeployed = code !== "0x";

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
    if (!this.wallet) {
      throw new Error("Wallet not configured for transaction signing");
    }

    try {
      if (!this.validateAddress(resolver)) {
        throw new Error(`Invalid resolver address: ${resolver}`);
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

      const htlcContract = this.getHTLCContract(htlcContractAddress);
      const tx = await htlcContract.createHTLC(
        order.secretHash,
        order.timeout,
        resolver,
        order.orderHash,
        { value: ethers.parseEther(order.sourceAmount) }
      );

      const receipt = await tx.wait();

      this.logOperation(
        "createEscrow",
        { orderHash: order.orderHash, resolver, htlcContractAddress },
        receipt.hash
      );
      return receipt.hash;
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
      const htlcContract = this.getHTLCContract(htlcContractAddress);
      const htlcDetails = await htlcContract.getHTLCDetails(orderHash);

      const escrowDetails: EscrowDetails = {
        orderHash,
        chain: this.config.name,
        contractAddress: htlcContractAddress,
        secretHash: htlcDetails.secretHash,
        amount: htlcDetails.amount.toString(),
        timeout: Number(htlcDetails.timeout),
        creator: htlcDetails.user,
        designated: htlcDetails.designatedRelayer,
        isCreated: htlcDetails.amount > 0,
        isWithdrawn: htlcDetails.claimed,
        isCancelled: htlcDetails.refunded,
        createdAt: Number(htlcDetails.createdAt),
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
    if (!this.wallet) {
      throw new Error("Wallet not configured for transaction signing");
    }

    try {
      const htlcContract = this.getHTLCContract(htlcContractAddress);
      const tx = await htlcContract.claimHTLC(orderHash, secret);
      const receipt = await tx.wait();

      this.logOperation(
        "withdrawFromEscrow",
        { orderHash, htlcContractAddress },
        receipt.hash
      );
      return receipt.hash;
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
    if (!this.wallet) {
      throw new Error("Wallet not configured for transaction signing");
    }

    try {
      const htlcContract = this.getHTLCContract(htlcContractAddress);
      const tx = await htlcContract.refundHTLC(orderHash);
      const receipt = await tx.wait();

      this.logOperation(
        "cancelEscrow",
        { orderHash, htlcContractAddress },
        receipt.hash
      );
      return receipt.hash;
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
      const blockNumber = await this.provider.getBlockNumber();
      this.logOperation("getBlockNumber", {}, blockNumber);
      return blockNumber;
    } catch (error) {
      this.logOperation("getBlockNumber", {}, undefined, error as Error);
      throw error;
    }
  }

  async getTransaction(hash: string): Promise<any> {
    try {
      const tx = await this.provider.getTransaction(hash);
      const receipt = await this.provider.getTransactionReceipt(hash);

      const result = {
        ...tx,
        receipt,
        confirmations: receipt ? await receipt.confirmations() : 0,
      };

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
      let gasEstimate: bigint;

      if (!htlcContractAddress) {
        throw new Error("HTLC contract address is required for gas estimation");
      }

      const htlcContract = this.getHTLCContract(htlcContractAddress);

      switch (operation) {
        case "createEscrow":
          gasEstimate = await htlcContract.createHTLC.estimateGas(
            params.secretHash,
            params.timeout,
            params.resolver,
            params.orderHash,
            { value: ethers.parseEther(params.amount) }
          );
          break;
        case "withdraw":
          gasEstimate = await htlcContract.claimHTLC.estimateGas(
            params.orderHash,
            params.secret
          );
          break;
        case "cancel":
          gasEstimate = await htlcContract.refundHTLC.estimateGas(
            params.orderHash
          );
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      const gas = Number(gasEstimate);
      this.logOperation("estimateGas", { operation, params }, gas);
      return gas;
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
}
