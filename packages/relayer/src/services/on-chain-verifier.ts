import { createPublicClient, http, Address, Hash, getContract } from "viem";
import { sepolia, mainnet, base, bsc, polygon, arbitrum } from "viem/chains";
import { JsonRpcProvider } from "@near-js/providers";
import { Logger } from "winston";

// USDC contract addresses on different chains
const USDC_ADDRESSES = {
  "1": "0xA0b86991c6218a36c1d19D4a2e9Eb0cE3606eB48", // Ethereum mainnet
  "11155111": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia testnet
  "8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  "56": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // BSC
  "137": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Polygon
  "42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
} as const;

// Chain configs for viem
const CHAIN_CONFIGS = {
  "1": mainnet,
  "11155111": sepolia,
  "8453": base,
  "56": bsc,
  "137": polygon,
  "42161": arbitrum,
} as const;

// ERC20 ABI for balance checking
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface EscrowVerificationResult {
  exists: boolean;
  deployedAtTxHash: boolean;
  hasUsdcBalance: boolean;
  usdcBalance: string;
  deploymentBlockNumber?: number;
  verificationDetails: {
    contractExists: boolean;
    txHashMatches: boolean;
    blockNumberMatches: boolean;
    sufficientBalance: boolean;
    expectedAmount?: string;
  };
  errors: string[];
}

// Type definitions for API responses
interface EtherscanContractResponse {
  status: string;
  message?: string;
  result?: Array<{
    contractAddress: string;
    contractCreator: string;
    txhash: string;
  }>;
}

interface NearBlocksTransactionResponse {
  txns?: Array<{
    hash: string;
    signer_account_id: string;
    receiver_account_id: string;
    actions?: Array<{
      args?: {
        account_id?: string;
      };
    }>;
  }>;
}

export interface VerificationRequest {
  orderHash: string;
  escrowAddress: string;
  transactionHash: string;
  blockNumber: number;
  chainId: string;
  expectedAmount?: string; // Expected USDC amount in the escrow
}

export class OnChainVerifier {
  private logger: Logger;
  private etherscanApiKey: string;
  private nearBlocksApiKey: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.etherscanApiKey =
      process.env.ETHERSCAN_API_KEY || "JCF3ANANGEKMZR23SP97UH65GUSJE31AWM";
    this.nearBlocksApiKey =
      process.env.NEARBLOCKS_API_KEY || "A1EAC21401AF4F608571477261FF3CE0";
  }

  /**
   * Verify EVM escrow deployment and balance
   */
  async verifyEvmEscrow(
    request: VerificationRequest
  ): Promise<EscrowVerificationResult> {
    const {
      escrowAddress,
      transactionHash,
      blockNumber,
      chainId,
      expectedAmount,
    } = request;

    this.logger.info("Starting EVM escrow verification", {
      escrowAddress,
      transactionHash,
      blockNumber,
      chainId,
      expectedAmount,
    });

    const result: EscrowVerificationResult = {
      exists: false,
      deployedAtTxHash: false,
      hasUsdcBalance: false,
      usdcBalance: "0",
      verificationDetails: {
        contractExists: false,
        txHashMatches: false,
        blockNumberMatches: false,
        sufficientBalance: false,
        expectedAmount,
      },
      errors: [],
    };

    try {
      // Get the chain config
      const chain = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
      if (!chain) {
        result.errors.push(`Unsupported chain ID: ${chainId}`);
        return result;
      }

      // Create viem client
      const client = createPublicClient({
        chain,
        transport: http(),
      });

      // 1. Check if contract exists at the address
      const bytecode = await client.getBytecode({
        address: escrowAddress as Address,
      });
      result.verificationDetails.contractExists =
        bytecode !== undefined && bytecode !== "0x";
      result.exists = result.verificationDetails.contractExists;

      if (!result.exists) {
        result.errors.push(`No contract found at address ${escrowAddress}`);
        return result;
      }

      // 2. Verify the transaction hash and block number
      try {
        const txReceipt = await client.getTransactionReceipt({
          hash: transactionHash as Hash,
        });

        result.verificationDetails.txHashMatches = true;
        result.deploymentBlockNumber = Number(txReceipt.blockNumber);
        result.verificationDetails.blockNumberMatches =
          result.deploymentBlockNumber === blockNumber;
        result.deployedAtTxHash = result.verificationDetails.blockNumberMatches;

        if (!result.verificationDetails.blockNumberMatches) {
          result.errors.push(
            `Block number mismatch: expected ${blockNumber}, got ${result.deploymentBlockNumber}`
          );
        }

        // Check if the transaction actually deployed a contract to this address
        const contractAddress = txReceipt.contractAddress;
        if (
          contractAddress &&
          contractAddress.toLowerCase() !== escrowAddress.toLowerCase()
        ) {
          result.errors.push(
            `Transaction deployed contract to ${contractAddress}, not ${escrowAddress}`
          );
          result.deployedAtTxHash = false;
        }
      } catch (error) {
        result.errors.push(
          `Failed to verify transaction hash: ${(error as Error).message}`
        );
        result.verificationDetails.txHashMatches = false;
      }

      // 3. Check USDC balance
      const usdcAddress =
        USDC_ADDRESSES[chainId as keyof typeof USDC_ADDRESSES];
      if (!usdcAddress) {
        result.errors.push(`USDC address not configured for chain ${chainId}`);
        return result;
      }

      try {
        const usdcContract = getContract({
          address: usdcAddress as Address,
          abi: ERC20_ABI,
          client,
        });

        const balance = await usdcContract.read.balanceOf([
          escrowAddress as Address,
        ]);
        const decimals = await usdcContract.read.decimals();

        result.usdcBalance = balance.toString();
        result.hasUsdcBalance = balance > 0n;

        // Convert balance to human readable format
        const balanceFormatted = Number(balance) / Math.pow(10, decimals);

        this.logger.info("USDC balance check", {
          escrowAddress,
          balance: balance.toString(),
          balanceFormatted,
          decimals,
          hasBalance: result.hasUsdcBalance,
        });

        // Check if balance meets expected amount
        if (expectedAmount) {
          const expectedBigInt = BigInt(expectedAmount);
          result.verificationDetails.sufficientBalance =
            balance >= expectedBigInt;

          if (!result.verificationDetails.sufficientBalance) {
            result.errors.push(
              `Insufficient USDC balance: expected ${expectedAmount}, got ${balance.toString()}`
            );
          }
        } else {
          result.verificationDetails.sufficientBalance = result.hasUsdcBalance;
        }
      } catch (error) {
        result.errors.push(
          `Failed to check USDC balance: ${(error as Error).message}`
        );
      }

      // 4. Additional verification using Etherscan API (for Sepolia)
      if (chainId === "11155111") {
        try {
          await this.verifyWithEtherscan(
            escrowAddress,
            transactionHash,
            result
          );
        } catch (error) {
          this.logger.warn("Etherscan verification failed", {
            error: (error as Error).message,
            escrowAddress,
          });
          // Don't fail the entire verification if Etherscan fails
        }
      }

      this.logger.info("EVM escrow verification completed", {
        escrowAddress,
        result: {
          exists: result.exists,
          deployedAtTxHash: result.deployedAtTxHash,
          hasUsdcBalance: result.hasUsdcBalance,
          errorsCount: result.errors.length,
        },
      });

      return result;
    } catch (error) {
      result.errors.push(`Verification failed: ${(error as Error).message}`);
      this.logger.error("EVM escrow verification error", {
        error: (error as Error).message,
        escrowAddress,
        transactionHash,
      });
      return result;
    }
  }

  /**
   * Additional verification using Etherscan API
   */
  private async verifyWithEtherscan(
    contractAddress: string,
    txHash: string,
    result: EscrowVerificationResult
  ): Promise<void> {
    const baseUrl = "https://api-sepolia.etherscan.io/api";

    try {
      // Verify contract creation
      const contractResponse = await fetch(
        `${baseUrl}?module=contract&action=getcontractcreation&contractaddresses=${contractAddress}&apikey=${this.etherscanApiKey}`
      );

      if (contractResponse.ok) {
        const contractData =
          (await contractResponse.json()) as EtherscanContractResponse;

        if (
          contractData.status === "1" &&
          contractData.result &&
          contractData.result.length > 0
        ) {
          const creationInfo = contractData.result[0];
          const etherscanTxHash = creationInfo.txhash;

          if (etherscanTxHash.toLowerCase() === txHash.toLowerCase()) {
            this.logger.info(
              "Etherscan verification: Transaction hash confirmed",
              {
                contractAddress,
                txHash,
              }
            );
          } else {
            result.errors.push(
              `Etherscan shows different creation tx: ${etherscanTxHash} vs ${txHash}`
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn("Etherscan API call failed", {
        error: (error as Error).message,
        contractAddress,
      });
    }
  }

  /**
   * Verify NEAR escrow deployment and balance
   */
  async verifyNearEscrow(
    request: VerificationRequest
  ): Promise<EscrowVerificationResult> {
    const { escrowAddress, transactionHash, expectedAmount } = request;

    this.logger.info("Starting NEAR escrow verification", {
      escrowAddress,
      transactionHash,
      expectedAmount,
    });

    const result: EscrowVerificationResult = {
      exists: false,
      deployedAtTxHash: false,
      hasUsdcBalance: false,
      usdcBalance: "0",
      verificationDetails: {
        contractExists: false,
        txHashMatches: false,
        blockNumberMatches: true, // NEAR doesn't use block numbers the same way
        sufficientBalance: false,
        expectedAmount,
      },
      errors: [],
    };

    try {
      // Determine RPC URL based on chain
      const rpcUrl =
        request.chainId === "398"
          ? "https://rpc.testnet.near.org"
          : "https://rpc.mainnet.near.org";

      const provider = new JsonRpcProvider({ url: rpcUrl });

      // 1. Check if account/contract exists
      try {
        const accountState = await provider.query({
          request_type: "view_account",
          finality: "final",
          account_id: escrowAddress,
        });

        result.verificationDetails.contractExists = true;
        result.exists = true;

        this.logger.info("NEAR account found", {
          escrowAddress,
          accountState,
        });
      } catch (error) {
        result.errors.push(`NEAR account not found: ${escrowAddress}`);
        result.verificationDetails.contractExists = false;
        return result;
      }

      // 2. Verify transaction hash using NearBlocks API
      try {
        await this.verifyNearTransaction(
          transactionHash,
          escrowAddress,
          result
        );
      } catch (error) {
        this.logger.warn("NEAR transaction verification failed", {
          error: (error as Error).message,
          transactionHash,
        });
      }

      // 3. Check USDC balance using NEAR API
      try {
        // For NEAR testnet, USDC might be a different token
        // We'll check the account balance and any fungible token balances
        await this.checkNearUsdcBalance(
          provider,
          escrowAddress,
          expectedAmount,
          result
        );
      } catch (error) {
        result.errors.push(
          `Failed to check NEAR USDC balance: ${(error as Error).message}`
        );
      }

      this.logger.info("NEAR escrow verification completed", {
        escrowAddress,
        result: {
          exists: result.exists,
          deployedAtTxHash: result.deployedAtTxHash,
          hasUsdcBalance: result.hasUsdcBalance,
          errorsCount: result.errors.length,
        },
      });

      return result;
    } catch (error) {
      result.errors.push(
        `NEAR verification failed: ${(error as Error).message}`
      );
      this.logger.error("NEAR escrow verification error", {
        error: (error as Error).message,
        escrowAddress,
        transactionHash,
      });
      return result;
    }
  }

  /**
   * Verify NEAR transaction using NearBlocks API
   */
  private async verifyNearTransaction(
    txHash: string,
    expectedAccount: string,
    result: EscrowVerificationResult
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://api.nearblocks.io/v1/txns/${txHash}`,
        {
          headers: {
            Authorization: `Bearer ${this.nearBlocksApiKey}`,
          },
        }
      );

      if (response.ok) {
        const txData = (await response.json()) as NearBlocksTransactionResponse;

        if (txData.txns && txData.txns.length > 0) {
          const tx = txData.txns[0];

          // Check if transaction involves the expected account
          const involvesAccount =
            tx.signer_account_id === expectedAccount ||
            tx.receiver_account_id === expectedAccount ||
            (tx.actions &&
              tx.actions.some(
                (action: any) => action.args?.account_id === expectedAccount
              ));

          if (involvesAccount) {
            result.verificationDetails.txHashMatches = true;
            result.deployedAtTxHash = true;

            this.logger.info("NEAR transaction verified", {
              txHash,
              expectedAccount,
              signerAccount: tx.signer_account_id,
              receiverAccount: tx.receiver_account_id,
            });
          } else {
            result.errors.push(
              `Transaction ${txHash} does not involve account ${expectedAccount}`
            );
          }
        } else {
          result.errors.push(`Transaction ${txHash} not found on NearBlocks`);
        }
      } else {
        result.errors.push(`NearBlocks API error: ${response.status}`);
      }
    } catch (error) {
      throw new Error(
        `NearBlocks API call failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Check NEAR USDC balance
   */
  private async checkNearUsdcBalance(
    provider: JsonRpcProvider,
    accountId: string,
    expectedAmount: string | undefined,
    result: EscrowVerificationResult
  ): Promise<void> {
    try {
      // For now, check NEAR balance as a proxy
      // In production, you'd want to check specific fungible token contracts
      const account = await provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });

      const accountInfo = account as any;
      const balance = accountInfo.amount || "0";

      result.usdcBalance = balance;
      result.hasUsdcBalance = BigInt(balance) > 0n;

      if (expectedAmount) {
        const expectedBigInt = BigInt(expectedAmount);
        result.verificationDetails.sufficientBalance =
          BigInt(balance) >= expectedBigInt;

        if (!result.verificationDetails.sufficientBalance) {
          result.errors.push(
            `Insufficient NEAR balance: expected ${expectedAmount}, got ${balance}`
          );
        }
      } else {
        result.verificationDetails.sufficientBalance = result.hasUsdcBalance;
      }

      this.logger.info("NEAR balance check", {
        accountId,
        balance,
        expectedAmount,
        hasBalance: result.hasUsdcBalance,
      });

      // TODO: Add proper fungible token balance checking
      // This would involve calling view methods on specific FT contracts
    } catch (error) {
      throw new Error(
        `Failed to check NEAR balance: ${(error as Error).message}`
      );
    }
  }

  /**
   * Main verification method that routes to appropriate chain verifier
   */
  async verifyEscrowDeployment(
    request: VerificationRequest
  ): Promise<EscrowVerificationResult> {
    const { chainId } = request;

    // Determine if this is EVM or NEAR
    if (
      chainId === "397" ||
      chainId === "398" ||
      chainId === "mainnet" ||
      chainId === "testnet"
    ) {
      return this.verifyNearEscrow(request);
    } else {
      return this.verifyEvmEscrow(request);
    }
  }
}
