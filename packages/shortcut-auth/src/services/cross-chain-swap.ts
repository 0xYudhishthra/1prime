// Cross-chain swap orchestration service

import { createRelayerClient, mapRelayerError } from '../utils/relayer-client';
import {
  generateSecretAndHash,
  signFusionOrder,
  signSecretReveal,
  createMerkleProof,
  getUserAddressForChain,
  isNearChain,
} from '../utils/order-signing';
import { KeyPairString } from '@near-js/crypto';
import {
  CrossChainSwapRequest,
  CrossChainOrderRecord,
  OrderPhase,
  CrossChainSwapError,
  OrderStatusResponse,
  StatusHistoryEntry,
} from '../types/cross-chain';
import { crossChainOrder } from '../db/schema';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export class CrossChainSwapService {
  private relayerClient = createRelayerClient();
  private db: PostgresJsDatabase<any>;

  constructor(databaseUrl: string) {
    // Note: This needs to be properly initialized with the database connection
    // For now, we'll assume the db is passed or initialized elsewhere
    this.db = null as any; // Will be set by the caller
  }

  setDatabase(db: PostgresJsDatabase<any>) {
    this.db = db;
  }

  /**
   * Execute the complete cross-chain swap flow
   */
  async executeSwap(
    request: CrossChainSwapRequest,
    userId: string,
    evmAddress: string,
    evmPrivateKey: string,
    nearAccountId?: string,
    nearKeypair?: KeyPairString
  ): Promise<{ orderId: string; result: 'completed' | 'failed'; error?: string }> {
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('Starting cross-chain swap:', { orderId, userId, request });

    try {
      // Validate credentials based on source chain
      const sourceIsNear = isNearChain(request.fromChain);
      if (sourceIsNear && (!nearAccountId || !nearKeypair)) {
        throw new Error('NEAR account ID and keypair required for NEAR source chain');
      }

      // Get the correct user address for the source chain
      const userAddress = getUserAddressForChain(
        request.fromChain, 
        evmAddress, 
        nearAccountId || ''
      );

      console.log('Chain-aware swap setup:', {
        sourceChain: request.fromChain,
        destinationChain: request.toChain,
        sourceIsNear,
        userAddress,
      });

      // Step 1 & 2: Generate random number and hash
      const { secret, secretHash } = generateSecretAndHash();
      
      // Create initial database record
      const orderRecord = await this.createOrderRecord(
        orderId,
        userId,
        request,
        secret,
        secretHash
      );

      console.log('Order record created:', { orderId, phase: orderRecord.currentPhase });

      // Step 3-6: Prepare and submit order
      const orderStatus = await this.prepareAndSubmitOrder(
        orderRecord,
        userAddress,
        request.fromChain,
        evmPrivateKey,
        nearKeypair,
        nearAccountId
      );

      console.log('Order submitted:', { orderHash: orderStatus.orderHash, phase: orderStatus.phase });

      // Step 8-11: Poll status and handle completion
      const finalStatus = await this.pollAndCompleteOrder(
        orderRecord,
        request.fromChain,
        evmPrivateKey,
        nearKeypair,
        nearAccountId
      );

      console.log('Swap completed:', { orderId, phase: finalStatus.phase, completed: finalStatus.isCompleted });

      return {
        orderId,
        result: finalStatus.isCompleted ? 'completed' : 'failed',
      };

    } catch (error) {
      console.error('Swap execution failed:', error);
      
      // Update database with error
      await this.updateOrderError(orderId, error instanceof Error ? error.message : 'Unknown error');
      
      return {
        orderId,
        result: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create initial order record in database
   */
  private async createOrderRecord(
    orderId: string,
    userId: string,
    request: CrossChainSwapRequest,
    secret: string,
    secretHash: string
  ): Promise<CrossChainOrderRecord> {
    const orderRecord: Partial<CrossChainOrderRecord> = {
      id: orderId,
      userId,
      randomNumber: secret,
      secretHash,
      sourceChain: request.fromChain,
      destinationChain: request.toChain,
      sourceToken: request.fromToken,
      destinationToken: request.toToken,
      sourceAmount: request.amount,
      currentPhase: 'preparing',
      relayerUrl: request.relayerUrl || 'https://1prime-relayer.up.railway.app/api/v1',
      isCompleted: false,
      secretRevealed: false,
      statusHistory: [{
        phase: 'preparing',
        timestamp: Date.now(),
        data: { request },
      }],
    };

    await this.db.insert(crossChainOrder).values(orderRecord as any);
    
    return orderRecord as CrossChainOrderRecord;
  }

  /**
   * Steps 3-6: Prepare order with relayer and submit signed order
   */
  private async prepareAndSubmitOrder(
    orderRecord: CrossChainOrderRecord,
    userAddress: string,
    sourceChain: string,
    evmPrivateKey: string,
    nearKeypair?: KeyPairString,
    nearAccountId?: string
  ): Promise<OrderStatusResponse> {
    try {
      // Update phase to preparing
      await this.updateOrderPhase(orderRecord.id, 'preparing');

      // Step 3: Prepare order with relayer
      const prepareRequest = {
        userAddress,
        amount: orderRecord.sourceAmount,
        fromToken: orderRecord.sourceToken,
        toToken: orderRecord.destinationToken,
        fromChain: orderRecord.sourceChain,
        toChain: orderRecord.destinationChain,
        secretHash: orderRecord.secretHash,
      };

      console.log('Preparing order with relayer...');
      const prepareResponse = await this.relayerClient.prepareOrder(prepareRequest);
      
      // Update database with order hash and prepared order data
      await this.updateOrderData(orderRecord.id, {
        orderHash: prepareResponse.orderHash,
        orderData: prepareResponse,
      });

      console.log('Order prepared, signing...');
      
      // Step 5: Sign the orderHash with chain-aware signing
      const signature = await signFusionOrder(
        prepareResponse.orderHash,  // Just the hash, not the full response
        sourceChain,
        evmPrivateKey,
        nearKeypair,
        nearAccountId
      );
      
      // Update database with signed order data
      await this.updateOrderPhase(orderRecord.id, 'signed');

      console.log('Order signed, submitting...');

      // Step 6: Submit signed order
      const submitRequest = {
        orderHash: prepareResponse.orderHash,
        signature,
      };

      const submitResponse = await this.relayerClient.submitSignedOrder(submitRequest);
      
      // Update database with submission response
      await this.updateOrderData(orderRecord.id, {
        currentPhase: submitResponse.phase,
        signedOrderData: submitResponse,
      });

      await this.updateOrderPhase(orderRecord.id, submitResponse.phase);

      return submitResponse;

    } catch (error) {
      console.error('Order preparation/submission failed:', error);
      await this.updateOrderError(orderRecord.id, `Preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw mapRelayerError(error instanceof Error ? error : new Error('Unknown error'), 'preparation');
    }
  }

  /**
   * Steps 8-11: Poll order status and handle completion
   */
  private async pollAndCompleteOrder(
    orderRecord: CrossChainOrderRecord,
    sourceChain: string,
    evmPrivateKey: string,
    nearKeypair?: KeyPairString,
    nearAccountId?: string
  ): Promise<OrderStatusResponse> {
    try {
      const orderHash = await this.getOrderHash(orderRecord.id);
      if (!orderHash) {
        throw new Error('Order hash not found');
      }

      console.log('Starting status polling for order:', orderHash);

      // Poll order status with status update callback
      const finalStatus = await this.relayerClient.pollOrderStatus(
        orderHash,
        async (status) => {
          console.log('Status update:', { phase: status.phase, completed: status.isCompleted });
          
          // Update database with latest status
          await this.updateOrderPhase(orderRecord.id, status.phase);
          
          // Step 11: Handle secret revelation when ready
          if (status.phase === 'waiting-for-secret' && !orderRecord.secretRevealed) {
            await this.handleSecretRevelation(
              orderRecord, 
              orderHash, 
              sourceChain, 
              evmPrivateKey, 
              nearKeypair, 
              nearAccountId
            );
          }
        }
      );

      // Mark order as completed
      await this.updateOrderCompletion(orderRecord.id, finalStatus.isCompleted, finalStatus.phase);

      return finalStatus;

    } catch (error) {
      console.error('Polling/completion failed:', error);
      await this.updateOrderError(orderRecord.id, `Polling failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw mapRelayerError(error instanceof Error ? error : new Error('Unknown error'), 'polling');
    }
  }

  /**
   * Step 11: Handle secret revelation when order reaches waiting-for-secret phase
   */
  private async handleSecretRevelation(
    orderRecord: CrossChainOrderRecord,
    orderHash: string,
    sourceChain: string,
    evmPrivateKey: string,
    nearKeypair?: KeyPairString,
    nearAccountId?: string
  ): Promise<void> {
    try {
      console.log('Handling secret revelation for order:', orderHash);

      // First verify escrows are safe
      console.log('Verifying escrow safety...');
      const escrowVerification = await this.relayerClient.verifyEscrowSafety(orderHash);
      
      if (!escrowVerification.safe) {
        throw new Error(`Escrow verification failed: ${escrowVerification.message}. Issues: ${escrowVerification.verification.issues?.join(', ')}`);
      }

      console.log('Escrows verified as safe, revealing secret...');

      // Create merkle proof for secret revelation
      const proof = createMerkleProof(orderRecord.randomNumber, orderHash);
      
      // Sign the secret reveal request with chain-aware signing
      const signature = await signSecretReveal(
        orderHash, 
        orderRecord.randomNumber, 
        sourceChain,
        evmPrivateKey,
        nearKeypair,
        nearAccountId
      );

      // Reveal secret to relayer
      const revealRequest = {
        orderHash,
        secret: orderRecord.randomNumber,
        proof,
        signature,
      };

      const revealResponse = await this.relayerClient.revealSecret(revealRequest);
      
      console.log('Secret revealed successfully:', revealResponse);

      // Update database
      await this.updateSecretRevelation(orderRecord.id);

    } catch (error) {
      console.error('Secret revelation failed:', error);
      await this.updateOrderError(orderRecord.id, `Secret revelation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw mapRelayerError(error instanceof Error ? error : new Error('Unknown error'), 'secret_reveal');
    }
  }

  // Database update methods

  private async updateOrderPhase(orderId: string, phase: OrderPhase): Promise<void> {
    const historyEntry: StatusHistoryEntry = {
      phase,
      timestamp: Date.now(),
    };

    // Get current order to update status history
    const currentOrder = await this.db
      .select({ statusHistory: crossChainOrder.statusHistory })
      .from(crossChainOrder)
      .where(eq(crossChainOrder.id, orderId))
      .limit(1);

    const currentHistory = currentOrder[0]?.statusHistory || [];
    const updatedHistory = [...currentHistory, historyEntry];

    await this.db
      .update(crossChainOrder)
      .set({
        currentPhase: phase,
        statusHistory: updatedHistory,
        updatedAt: new Date(),
      })
      .where(eq(crossChainOrder.id, orderId));
  }

  private async updateOrderData(orderId: string, data: Partial<CrossChainOrderRecord>): Promise<void> {
    await this.db
      .update(crossChainOrder)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(crossChainOrder.id, orderId));
  }

  private async updateOrderError(orderId: string, error: string): Promise<void> {
    await this.db
      .update(crossChainOrder)
      .set({
        errorMessage: error,
        isSuccessful: false,
        updatedAt: new Date(),
      })
      .where(eq(crossChainOrder.id, orderId));
  }

  private async updateOrderCompletion(orderId: string, isCompleted: boolean, phase: OrderPhase): Promise<void> {
    await this.db
      .update(crossChainOrder)
      .set({
        isCompleted,
        isSuccessful: isCompleted && phase === 'completed',
        currentPhase: phase,
        completedAt: isCompleted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(crossChainOrder.id, orderId));
  }

  private async updateSecretRevelation(orderId: string): Promise<void> {
    await this.db
      .update(crossChainOrder)
      .set({
        secretRevealed: true,
        secretRevealedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(crossChainOrder.id, orderId));
  }

  private async getOrderHash(orderId: string): Promise<string | null> {
    const result = await this.db
      .select({ orderHash: crossChainOrder.orderHash })
      .from(crossChainOrder)
      .where(eq(crossChainOrder.id, orderId))
      .limit(1);

    return result[0]?.orderHash || null;
  }

  /**
   * Get order status by ID - returns LIVE status from relayer, not local database
   */
  async getOrderStatus(orderId: string): Promise<CrossChainOrderRecord & { liveStatus?: OrderStatusResponse } | null> {
    // First get the local order record to get the order hash
    const result = await this.db
      .select()
      .from(crossChainOrder)
      .where(eq(crossChainOrder.id, orderId))
      .limit(1);

    const localOrder = result[0];
    if (!localOrder) {
      return null;
    }

    // If we have an order hash, get live status from relayer
    let liveStatus: OrderStatusResponse | undefined;
    if (localOrder.orderHash) {
      try {
        console.log('Fetching live status from relayer for order:', localOrder.orderHash);
        liveStatus = await this.relayerClient.getOrderStatus(localOrder.orderHash);
        
        // Update local database with latest status from relayer
        if (liveStatus.phase !== localOrder.currentPhase) {
          await this.updateOrderPhase(orderId, liveStatus.phase);
          await this.updateOrderCompletion(orderId, liveStatus.isCompleted, liveStatus.phase);
        }
      } catch (error) {
        console.error('Failed to fetch live status from relayer:', error);
        // Fall back to local status if relayer is unreachable
      }
    }

    return {
      ...localOrder,
      liveStatus,
    } as CrossChainOrderRecord & { liveStatus?: OrderStatusResponse };
  }

  /**
   * Get local order record only (for internal use)
   */
  async getLocalOrderRecord(orderId: string): Promise<CrossChainOrderRecord | null> {
    const result = await this.db
      .select()
      .from(crossChainOrder)
      .where(eq(crossChainOrder.id, orderId))
      .limit(1);

    return result[0] as CrossChainOrderRecord || null;
  }

  /**
   * Get all orders for a user
   */
  async getUserOrders(userId: string): Promise<CrossChainOrderRecord[]> {
    const result = await this.db
      .select()
      .from(crossChainOrder)
      .where(eq(crossChainOrder.userId, userId))
      .orderBy(crossChainOrder.createdAt);
    
    return result as CrossChainOrderRecord[];
  }
}