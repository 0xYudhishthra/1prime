import { EventEmitter } from "events";
import type { Logger } from "winston";
import { createHash } from "crypto";
import {
  SecretManagement,
  MerkleSecretTree,
  PartialFill,
  FusionOrder,
  SecretRevealRequest,
  RelayerStatus,
} from "../types";

export interface SecretRevealConditions {
  orderHash: string;
  escrowsVerified: boolean;
  finalityReached: boolean;
  resolverVerified: boolean;
  timeConditionsMet: boolean;
}

export class SecretManager extends EventEmitter {
  private logger: Logger;
  private secrets: Map<string, SecretManagement> = new Map();
  private resolvers: Map<string, RelayerStatus> = new Map();
  private revealConditions: Map<string, SecretRevealConditions> = new Map();
  private revealTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  async storeSecret(
    orderHash: string,
    secret: string,
    secretHash: string
  ): Promise<void> {
    try {
      if (!this.validateSecret(secret, secretHash)) {
        throw new Error("Secret validation failed - hash mismatch");
      }

      const secretManagement: SecretManagement = {
        orderHash,
        secret,
        secretHash,
        isRevealed: false,
      };

      this.secrets.set(orderHash, secretManagement);

      this.logger.info("Secret stored", { orderHash });
      this.emit("secret_stored", { orderHash });
    } catch (error) {
      this.logger.error("Failed to store secret", {
        orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async createMerkleSecretTree(
    orderHash: string,
    totalParts: number,
    masterSecret: string
  ): Promise<MerkleSecretTree> {
    try {
      if (totalParts < 2 || totalParts > 10) {
        throw new Error("Total parts must be between 2 and 10");
      }

      // Generate N+1 secrets for N parts (as per whitepaper)
      const secrets: string[] = [];
      for (let i = 0; i <= totalParts; i++) {
        const partSecret = this.generatePartialSecret(masterSecret, i);
        secrets.push(partSecret);
      }

      // Create Merkle root
      const merkleRoot = this.calculateMerkleRoot(secrets);

      const merkleTree: MerkleSecretTree = {
        orderHash,
        totalParts,
        secrets,
        merkleRoot,
        partialFills: [],
      };

      // Update secret management with Merkle tree
      const secretManagement = this.secrets.get(orderHash);
      if (secretManagement) {
        secretManagement.merkleTree = merkleTree;
        this.secrets.set(orderHash, secretManagement);
      }

      this.logger.info("Merkle secret tree created", {
        orderHash,
        totalParts,
        merkleRoot,
      });

      return merkleTree;
    } catch (error) {
      this.logger.error("Failed to create Merkle secret tree", {
        orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async setRevealConditions(
    orderHash: string,
    conditions: SecretRevealConditions
  ): Promise<void> {
    this.revealConditions.set(orderHash, conditions);

    // Check if all conditions are met
    if (this.areRevealConditionsMet(conditions)) {
      await this.conditionallyRevealSecret(orderHash);
    }

    this.logger.debug("Reveal conditions updated", {
      orderHash,
      conditionsMet: this.areRevealConditionsMet(conditions),
    });
  }

  async requestSecretReveal(
    request: SecretRevealRequest
  ): Promise<string | null> {
    try {
      const secretManagement = this.secrets.get(request.orderHash);
      if (!secretManagement) {
        throw new Error(`Secret not found for order: ${request.orderHash}`);
      }

      // Verify resolver is authorized
      if (!request.signature) {
        throw new Error("Signature is required for secret reveal");
      }
      const resolver = this.resolvers.get(request.signature.split(":")[0]); // Simplified signature parsing
      if (!resolver || !resolver.isKyc) {
        throw new Error("Unauthorized resolver");
      }

      // Check reveal conditions
      const conditions = this.revealConditions.get(request.orderHash);
      if (!conditions || !this.areRevealConditionsMet(conditions)) {
        this.logger.warn("Secret reveal conditions not met", {
          orderHash: request.orderHash,
          conditions,
        });
        return null;
      }

      // Verify proof (simplified - in production this would be more sophisticated)
      if (!this.verifySecretProof(request)) {
        throw new Error("Invalid secret reveal proof");
      }

      // Reveal the secret
      secretManagement.isRevealed = true;
      secretManagement.revealedAt = Date.now();
      secretManagement.revealedBy = resolver.address;

      this.logger.info("Secret revealed", {
        orderHash: request.orderHash,
        revealedTo: resolver.address,
      });

      this.emit("secret_revealed", {
        orderHash: request.orderHash,
        secret: secretManagement.secret,
        revealedTo: resolver.address,
      });

      return secretManagement.secret;
    } catch (error) {
      this.logger.error("Secret reveal failed", {
        orderHash: request.orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async handlePartialFill(
    orderHash: string,
    fillPercentage: number,
    resolver: string
  ): Promise<string | null> {
    try {
      const secretManagement = this.secrets.get(orderHash);
      if (!secretManagement?.merkleTree) {
        throw new Error("Merkle tree not found for partial fill");
      }

      const merkleTree = secretManagement.merkleTree;

      // Calculate which secret to use based on fill percentage
      const secretIndex = this.calculateSecretIndex(
        fillPercentage,
        merkleTree.totalParts
      );

      if (secretIndex >= merkleTree.secrets.length) {
        throw new Error("Invalid secret index for partial fill");
      }

      const secretToReveal = merkleTree.secrets[secretIndex];
      if (!secretToReveal) {
        throw new Error(`Secret at index ${secretIndex} not found`);
      }

      // Record the partial fill
      const partialFill: PartialFill = {
        fillIndex: secretIndex,
        fillPercentage,
        secretUsed: secretToReveal,
        resolver,
        timestamp: Date.now(),
      };

      merkleTree.partialFills.push(partialFill);

      this.logger.info("Partial fill processed", {
        orderHash,
        fillPercentage,
        secretIndex,
        resolver,
      });

      this.emit("partial_fill_processed", {
        orderHash,
        fillPercentage,
        secretIndex,
        resolver,
        secret: secretToReveal,
      });

      return secretToReveal;
    } catch (error) {
      this.logger.error("Partial fill handling failed", {
        orderHash,
        fillPercentage,
        resolver,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async scheduleSecretReveal(
    orderHash: string,
    delayMs: number
  ): Promise<void> {
    // Clear existing timeout if any
    const existingTimeout = this.revealTimeouts.get(orderHash);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new reveal
    const timeout = setTimeout(async () => {
      try {
        await this.conditionallyRevealSecret(orderHash);
        this.revealTimeouts.delete(orderHash);
      } catch (error) {
        this.logger.error("Scheduled secret reveal failed", {
          orderHash,
          error: (error as Error).message,
        });
      }
    }, delayMs);

    this.revealTimeouts.set(orderHash, timeout);

    this.logger.info("Secret reveal scheduled", { orderHash, delayMs });
  }

  getSecret(orderHash: string): SecretManagement | undefined {
    return this.secrets.get(orderHash);
  }

  isSecretRevealed(orderHash: string): boolean {
    const secret = this.secrets.get(orderHash);
    return secret?.isRevealed || false;
  }

  registerResolver(resolver: RelayerStatus): void {
    this.resolvers.set(resolver.address, resolver);
    this.logger.debug("Resolver registered for secret management", {
      address: resolver.address,
    });
  }

  private async conditionallyRevealSecret(orderHash: string): Promise<void> {
    const conditions = this.revealConditions.get(orderHash);
    if (!conditions || !this.areRevealConditionsMet(conditions)) {
      this.logger.debug("Secret reveal conditions not met", {
        orderHash,
        conditions,
      });
      return;
    }

    const secretManagement = this.secrets.get(orderHash);
    if (!secretManagement || secretManagement.isRevealed) {
      return;
    }

    // Reveal to all authorized resolvers
    const authorizedResolvers = Array.from(this.resolvers.values()).filter(
      resolver => resolver.isKyc
    );

    for (const resolver of authorizedResolvers) {
      this.emit("secret_disclosed", {
        orderHash,
        secret: secretManagement.secret,
        resolver: resolver.address,
      });
    }

    secretManagement.isRevealed = true;
    secretManagement.revealedAt = Date.now();

    this.logger.info(
      "Secret conditionally revealed to all authorized resolvers",
      {
        orderHash,
        resolverCount: authorizedResolvers.length,
      }
    );
  }

  private areRevealConditionsMet(conditions: SecretRevealConditions): boolean {
    return (
      conditions.escrowsVerified &&
      conditions.finalityReached &&
      conditions.resolverVerified &&
      conditions.timeConditionsMet
    );
  }

  private validateSecret(secret: string, expectedHash: string): boolean {
    const actualHash = createHash("sha256").update(secret).digest("hex");
    return actualHash === expectedHash;
  }

  private generatePartialSecret(masterSecret: string, index: number): string {
    const data = `${masterSecret}-${index}`;
    return createHash("sha256").update(data).digest("hex");
  }

  private calculateMerkleRoot(secrets: string[]): string {
    if (secrets.length === 0) {
      return "";
    }

    if (secrets.length === 1) {
      return createHash("sha256").update(secrets[0]).digest("hex");
    }

    // Simple Merkle tree implementation - in production this would be more sophisticated
    let currentLevel = secrets.map(secret =>
      createHash("sha256").update(secret).digest("hex")
    );

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left; // Handle odd number of nodes

        if (!left) {
          throw new Error(`Invalid merkle tree node at index ${i}`);
        }

        const combined = createHash("sha256")
          .update(left + (right || ""))
          .digest("hex");

        nextLevel.push(combined);
      }

      currentLevel = nextLevel;
    }

    const root = currentLevel[0];
    if (!root) {
      throw new Error("Invalid merkle tree - no root found");
    }
    return root;
  }

  private calculateSecretIndex(
    fillPercentage: number,
    totalParts: number
  ): number {
    // Convert percentage to part index
    // For example: 25% fill of 4 parts = index 1, 50% = index 2, etc.
    const partSize = 100 / totalParts;
    return Math.min(Math.floor(fillPercentage / partSize), totalParts - 1);
  }

  private verifySecretProof(request: SecretRevealRequest): boolean {
    // Simplified proof verification - in production this would involve
    // cryptographic proof verification (e.g., zk-SNARKs, Merkle proofs, etc.)

    // For now, just verify the request has required fields
    return !!(
      request.orderHash &&
      request.secret &&
      request.proof &&
      request.signature
    );
  }

  cleanup(): void {
    // Clear all timeouts
    for (const timeout of this.revealTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.revealTimeouts.clear();

    this.logger.info("Secret manager cleanup completed");
  }
}
