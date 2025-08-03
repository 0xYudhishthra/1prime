import { Contract, JsonRpcProvider, Interface } from "ethers";
import { ERC20_INTERFACE, ESCROW_INTERFACE } from "./interfaces";

export class ContractHelper {
  /**
   * Create ERC20 contract instance
   */
  static createERC20Contract(
    tokenAddress: string,
    provider: JsonRpcProvider
  ): Contract {
    return new Contract(tokenAddress, ERC20_INTERFACE, provider);
  }

  /**
   * Create 1inch Escrow contract instance
   */
  static createEscrowContract(
    escrowAddress: string,
    provider: JsonRpcProvider
  ): Contract {
    return new Contract(escrowAddress, ESCROW_INTERFACE, provider);
  }

  /**
   * Batch contract calls for better performance
   */
  static async batchContractCalls<T>(
    calls: Promise<T>[]
  ): Promise<(T | Error)[]> {
    const results = await Promise.allSettled(calls);
    return results.map(result =>
      result.status === "fulfilled" ? result.value : new Error(result.reason)
    );
  }

  /**
   * Quick ERC20 token info getter
   */
  static async getTokenInfo(tokenAddress: string, provider: JsonRpcProvider) {
    const contract = this.createERC20Contract(tokenAddress, provider);

    try {
      const [symbol, decimals, totalSupply] = await this.batchContractCalls([
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply(),
      ]);

      return {
        address: tokenAddress,
        symbol: symbol instanceof Error ? "UNKNOWN" : symbol,
        decimals: decimals instanceof Error ? 18 : Number(decimals),
        totalSupply:
          totalSupply instanceof Error ? "0" : totalSupply.toString(),
      };
    } catch (error) {
      throw new Error(`Failed to get token info: ${(error as Error).message}`);
    }
  }

  /**
   * Quick escrow verification
   */
  static async verifyEscrowContract(
    escrowAddress: string,
    provider: JsonRpcProvider
  ) {
    const contract = this.createEscrowContract(escrowAddress, provider);

    try {
      const [factory, rescueDelay] = await this.batchContractCalls([
        contract.FACTORY(),
        contract.RESCUE_DELAY(),
      ]);

      return {
        isValid: !(factory instanceof Error) && !(rescueDelay instanceof Error),
        factory: factory instanceof Error ? null : factory,
        rescueDelay:
          rescueDelay instanceof Error ? null : rescueDelay.toString(),
      };
    } catch (error) {
      return {
        isValid: false,
        factory: null,
        rescueDelay: null,
        error: (error as Error).message,
      };
    }
  }
}
