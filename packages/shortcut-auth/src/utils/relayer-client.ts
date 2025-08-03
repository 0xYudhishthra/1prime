// 1Prime Relayer API Client

import {
  RelayerApiResponse,
  GenerateOrderRequest,
  PrepareOrderResponse,
  SubmitSignedOrderRequest,
  OrderStatusResponse,
  SecretRevealRequest,
  EscrowVerificationResponse,
  RelayerConfig,
  CrossChainSwapError,
} from '../types/cross-chain';

export class RelayerClient {
  private config: RelayerConfig;

  constructor(config: RelayerConfig) {
    this.config = config;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<RelayerApiResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data: RelayerApiResponse<T> = await response.json();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${data.error || 'Unknown error'}`);
      }

      return data as RelayerApiResponse<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        throw new Error(`Relayer request failed: ${error.message}`);
      }
      throw new Error('Relayer request failed: Unknown error');
    }
  }

  /**
   * Step 3: Generate unsigned Fusion+ order for frontend signing
   */
  async prepareOrder(request: GenerateOrderRequest): Promise<PrepareOrderResponse> {
    console.log('Preparing order with relayer:', request);
    
    const response = await this.makeRequest<PrepareOrderResponse>('/orders/prepare', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.success || !response.data) {
      throw new Error(`Order preparation failed: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Step 6: Submit signed Fusion+ order to relayer
   */
  async submitSignedOrder(request: SubmitSignedOrderRequest): Promise<OrderStatusResponse> {
    console.log('Submitting signed order to relayer:', { orderHash: request.orderHash });
    
    const response = await this.makeRequest<OrderStatusResponse>('/orders/submit', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.success || !response.data) {
      throw new Error(`Order submission failed: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Step 8: Get order status for polling
   */
  async getOrderStatus(orderHash: string): Promise<OrderStatusResponse> {
    console.log('Getting order status:', orderHash);
    
    const response = await this.makeRequest<OrderStatusResponse>(`/orders/${orderHash}/status`);

    if (!response.success || !response.data) {
      throw new Error(`Status fetch failed: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Verify escrows are safe before revealing secret
   */
  async verifyEscrowSafety(orderHash: string): Promise<EscrowVerificationResponse> {
    console.log('Verifying escrow safety:', orderHash);
    
    const response = await this.makeRequest<EscrowVerificationResponse>(`/orders/${orderHash}/verify-escrows`);

    if (!response.success || !response.data) {
      throw new Error(`Escrow verification failed: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Step 11: Reveal secret to unlock funds
   */
  async revealSecret(request: SecretRevealRequest): Promise<{ secret: string }> {
    console.log('Revealing secret to relayer:', { orderHash: request.orderHash });
    
    const response = await this.makeRequest<{ secret: string }>(`/orders/${request.orderHash}/reveal-secret`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.success || !response.data) {
      throw new Error(`Secret reveal failed: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Poll order status until completion or timeout
   */
  async pollOrderStatus(
    orderHash: string,
    onStatusUpdate?: (status: OrderStatusResponse) => void
  ): Promise<OrderStatusResponse> {
    const startTime = Date.now();
    const maxDuration = this.config.maxPollingDuration;
    const interval = this.config.pollingInterval;

    while (Date.now() - startTime < maxDuration) {
      try {
        const status = await this.getOrderStatus(orderHash);
        
        if (onStatusUpdate) {
          onStatusUpdate(status);
        }

        // Check if order is completed or in a final state
        if (status.isCompleted || 
            status.phase === 'completed' || 
            status.phase === 'failed' || 
            status.phase === 'cancelled') {
          return status;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        console.error('Polling error:', error);
        // Continue polling unless it's a critical error
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    throw new Error(`Polling timeout after ${maxDuration}ms`);
  }

  /**
   * Get relayer health status
   */
  async getHealth(): Promise<any> {
    return this.makeRequest('/health');
  }
}

/**
 * Create a relayer client with default configuration
 */
export function createRelayerClient(baseUrl?: string): RelayerClient {
  const config: RelayerConfig = {
    baseUrl: baseUrl || 'https://1prime-relayer.up.railway.app/api/v1',
    timeout: 30000, // 30 seconds
    pollingInterval: 2000, // 2 seconds  
    maxPollingDuration: 300000, // 5 minutes
  };

  return new RelayerClient(config);
}

/**
 * Convert common relayer errors to our error types
 */
export function mapRelayerError(error: Error, phase?: string): CrossChainSwapError {
  const message = error.message.toLowerCase();
  
  if (message.includes('preparation') || message.includes('prepare')) {
    return {
      code: 'PREPARATION_FAILED',
      message: error.message,
      phase: phase as any,
    };
  }
  
  if (message.includes('signing') || message.includes('signature')) {
    return {
      code: 'SIGNING_FAILED',
      message: error.message,
      phase: phase as any,
    };
  }
  
  if (message.includes('submission') || message.includes('submit')) {
    return {
      code: 'SUBMISSION_FAILED',
      message: error.message,
      phase: phase as any,
    };
  }
  
  if (message.includes('timeout') || message.includes('polling')) {
    return {
      code: 'POLLING_TIMEOUT',
      message: error.message,
      phase: phase as any,
    };
  }
  
  if (message.includes('secret') || message.includes('reveal')) {
    return {
      code: 'SECRET_REVEAL_FAILED',
      message: error.message,
      phase: phase as any,
    };
  }
  
  if (message.includes('escrow') || message.includes('verification')) {
    return {
      code: 'ESCROW_VERIFICATION_FAILED',
      message: error.message,
      phase: phase as any,
    };
  }
  
  return {
    code: 'RELAYER_ERROR',
    message: error.message,
    phase: phase as any,
  };
}