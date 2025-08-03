import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "winston";
import { FusionOrder, OrderStatus, OrderEvent } from "../types";

export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface OrderRecord extends FusionOrder {
  status: OrderStatus;
  phase?: string; // TimelockPhase["phase"] - optional for backward compatibility
  createdAt: number;
  updatedAt: number;
  events: OrderEvent[];
}

export interface ResolverRecord {
  address: string;
  isKyc: boolean;
  reputation: number;
  completedOrders: number;
  lastActivity: number;
  createdAt: number;
  updatedAt: number;
}

export class DatabaseService {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(config: DatabaseConfig, logger: Logger) {
    this.logger = logger;
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);

    this.logger.info("Database service initialized", {
      supabaseUrl: config.supabaseUrl.substring(0, 20) + "...",
    });
  }

  // Order management methods
  async createOrder(order: FusionOrder): Promise<OrderRecord> {
    try {
      // Debug logging to see what we're working with
      this.logger.debug("Creating order with data", {
        orderHash: order.orderHash,
        hasOrderHash: !!order.orderHash,
        orderKeys: Object.keys(order),
        orderType: typeof order,
      });

      // Custom replacer to handle BigInt and complex objects
      const bigIntReplacer = (key: string, value: any) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };

      // Ensure orderHash is present
      if (!order.orderHash) {
        throw new Error("Order hash is required but missing from order object");
      }

      // Create a record that matches the existing database schema with exact column names
      const orderRecord = {
        // Use exact column names from schema (quoted in SQL, camelCase in JS)
        orderHash: order.orderHash,
        maker: order.maker || "",
        userSrcAddress: order.userSrcAddress || "",
        userDstAddress: order.userDstAddress || "",
        sourceChain: order.sourceChain || "",
        destinationChain: order.destinationChain || "",
        sourceToken: order.sourceToken || "",
        destinationToken: order.destinationToken || "",
        sourceAmount: order.sourceAmount || "0",
        destinationAmount: order.destinationAmount || "0",
        secretHash: order.secretHash || "",
        timeout: order.timeout || Date.now() + 3600000,

        initialRateBump: order.initialRateBump || 1000,
        signature: order.signature || "",
        nonce: order.nonce || "",

        // SDK-extracted fields (match the schema)
        receiver: (order as any).receiver || null,
        srcSafetyDeposit: (order as any).srcSafetyDeposit || null,
        dstSafetyDeposit: (order as any).dstSafetyDeposit || null,

        // Store complex objects in appropriate JSONB columns
        detailedTimeLocks: (order as any).detailedTimeLocks || null,
        enhancedAuctionDetails: (order as any).enhancedAuctionDetails || null,

        // NEAR address compatibility fields
        originalAddresses: (order as any).originalAddresses || null,
        processedAddresses: (order as any).processedAddresses || null,
        nearAddressMappings: (order as any).nearAddressMappings || null,

        // Standard tracking fields
        status: "pending",
        phase: (order as any).phase || "submitted", // Default to submitted phase
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [
          {
            type: "order_created",
            timestamp: Date.now(),
            data: { orderHash: order.orderHash },
          },
        ],
      };

      // Debug the record being inserted
      this.logger.debug("Inserting order record", {
        orderHash: orderRecord.orderHash,
        recordKeys: Object.keys(orderRecord),
        hasOrderHashInRecord: !!orderRecord.orderHash,
      });

      let { data, error } = await this.supabase
        .from("orders")
        .insert([orderRecord])
        .select()
        .single();

      if (error) {
        // Check if error is due to missing phase column
        if (
          error.message.includes(
            'column "phase" of relation "orders" does not exist'
          )
        ) {
          this.logger.warn(
            "Phase column does not exist, retrying without phase field",
            {
              orderHash: order.orderHash,
              error: error.message,
            }
          );

          // Remove phase field and retry
          const { phase, ...orderRecordWithoutPhase } = orderRecord;
          const retryResult = await this.supabase
            .from("orders")
            .insert([orderRecordWithoutPhase])
            .select()
            .single();

          if (retryResult.error) {
            throw new Error(
              `Failed to create order (retry): ${retryResult.error.message}`
            );
          }

          // Use retry data if successful
          data = retryResult.data;
        } else {
          throw new Error(`Failed to create order: ${error.message}`);
        }
      }

      this.logger.info("Order created in database", {
        orderHash: order.orderHash,
        sourceChain: order.sourceChain,
        destinationChain: order.destinationChain,
      });

      // Return the data in the expected format
      return {
        ...order,
        status: "pending" as unknown as OrderStatus,
        createdAt: orderRecord.createdAt,
        updatedAt: orderRecord.updatedAt,
        events: [
          {
            type: "order_created",
            timestamp: Date.now(),
            data: { orderHash: order.orderHash },
          },
        ],
      };
    } catch (error) {
      this.logger.error("Failed to create order", {
        orderHash: order.orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getOrder(orderHash: string): Promise<OrderRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from("orders")
        .select("*")
        .eq("orderHash", orderHash)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 is "not found"
        throw new Error(`Failed to get order: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      // Return the data directly since JSONB columns are automatically parsed by Supabase
      return data;
    } catch (error) {
      this.logger.error("Failed to get order", {
        orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateOrderStatus(
    orderHash: string,
    status: OrderStatus
  ): Promise<void> {
    try {
      const updateData: Partial<OrderRecord> = {
        status,
        updatedAt: Date.now(),
      };

      const { error } = await this.supabase
        .from("orders")
        .update(updateData)
        .eq("orderHash", orderHash);

      if (error) {
        throw new Error(`Failed to update order status: ${error.message}`);
      }

      this.logger.info("Order status updated", {
        orderHash,
        status,
      });
    } catch (error) {
      this.logger.error("Failed to update order status", {
        orderHash,
        status,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateOrderPhase(orderHash: string, phase: string): Promise<void> {
    try {
      const updateData: Partial<OrderRecord> = {
        phase,
        updatedAt: Date.now(),
      };

      const { error } = await this.supabase
        .from("orders")
        .update(updateData)
        .eq("orderHash", orderHash);

      if (error) {
        // Check if error is due to missing phase column
        if (
          error.message.includes(
            'column "phase" of relation "orders" does not exist'
          )
        ) {
          this.logger.warn(
            "Phase column does not exist, skipping phase update",
            {
              orderHash,
              phase,
              error: error.message,
            }
          );

          // Update status instead as fallback (map phase to status)
          const fallbackStatus = this.mapPhaseToStatus(phase);
          await this.updateOrderStatus(orderHash, fallbackStatus);
          return;
        }
        throw new Error(`Failed to update order phase: ${error.message}`);
      }

      this.logger.info("Order phase updated", {
        orderHash,
        phase,
      });
    } catch (error) {
      this.logger.error("Failed to update order phase", {
        orderHash,
        phase,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Atomically claim an order by updating phase and assigning resolver
   * This prevents race conditions and double claiming
   */
  async claimOrderAtomic(
    orderHash: string,
    resolverAddress: string,
    currentPhase: string = "submitted"
  ): Promise<void> {
    try {
      // Use a conditional update to ensure order is only claimed if in correct state
      const { data, error, count } = await this.supabase
        .from("orders")
        .update({
          phase: "claimed",
          assignedResolver: resolverAddress,
          updatedAt: Date.now(),
        })
        .eq("orderHash", orderHash)
        .eq("phase", currentPhase) // Only update if still in expected state
        .select("orderHash"); // Return data to check if update succeeded

      if (error) {
        // Check if error is due to missing phase or assignedResolver column
        if (
          error.message.includes(
            'column "phase" of relation "orders" does not exist'
          ) ||
          error.message.includes(
            "Could not find the 'assignedResolver' column"
          ) ||
          error.message.includes(
            'column "assignedResolver" of relation "orders" does not exist'
          )
        ) {
          this.logger.warn(
            "Phase or assignedResolver column does not exist, using status-based claim",
            {
              orderHash,
              resolverAddress,
              error: error.message,
            }
          );

          // Fallback: use status-based atomic update
          const { data: statusData, error: statusError } = await this.supabase
            .from("orders")
            .update({
              status: "auction_active", // maps to "claimed" phase
              updatedAt: Date.now(),
            })
            .eq("orderHash", orderHash)
            .eq("status", "pending") // Only update if still pending
            .select("orderHash");

          if (statusError) {
            throw new Error(
              `Failed to claim order atomically (status fallback): ${statusError.message}`
            );
          }

          // Check if the status-based update actually affected any rows
          if (!statusData || statusData.length === 0) {
            throw new Error(
              `Order cannot be claimed: either not found or not in 'pending' status (possibly already claimed)`
            );
          }

          this.logger.info("Order claimed atomically (status fallback)", {
            orderHash,
            resolverAddress,
            status: "auction_active",
          });
          return;
        }
        throw new Error(`Failed to claim order atomically: ${error.message}`);
      }

      // Check if the update actually affected any rows
      if (!data || data.length === 0) {
        throw new Error(
          `Order cannot be claimed: either not found or not in '${currentPhase}' state (possibly already claimed)`
        );
      }

      this.logger.info("Order claimed atomically", {
        orderHash,
        resolverAddress,
        phase: "claimed",
      });
    } catch (error) {
      this.logger.error("Failed to claim order atomically", {
        orderHash,
        resolverAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Map phase to status for backwards compatibility
  private mapPhaseToStatus(phase: string): any {
    const phaseToStatusMap: Record<string, string> = {
      submitted: "pending",
      claimed: "auction_active",
      src_escrow_deployed: "processing",
      dst_escrow_deployed: "processing",
      "waiting-for-secret": "processing",
      completed: "completed",
      cancelled: "cancelled",
    };

    return phaseToStatusMap[phase] || "pending";
  }

  async addOrderEvent(orderHash: string, event: OrderEvent): Promise<void> {
    try {
      // Get current events
      const { data: currentOrder, error: getError } = await this.supabase
        .from("orders")
        .select("events")
        .eq("orderHash", orderHash)
        .single();

      if (getError) {
        throw new Error(
          `Failed to get current order events: ${getError.message}`
        );
      }

      // Supabase automatically handles JSONB arrays
      const currentEvents = currentOrder.events || [];
      const updatedEvents = [...currentEvents, event];

      const { error } = await this.supabase
        .from("orders")
        .update({
          events: updatedEvents,
          updatedAt: Date.now(),
        })
        .eq("orderHash", orderHash);

      if (error) {
        throw new Error(`Failed to add order event: ${error.message}`);
      }

      this.logger.debug("Order event added", {
        orderHash,
        eventType: event.type,
      });
    } catch (error) {
      this.logger.error("Failed to add order event", {
        orderHash,
        eventType: event.type,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getOrdersByStatus(status: OrderStatus): Promise<OrderRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from("orders")
        .select("*")
        .eq("status", status)
        .order("createdAt", { ascending: false });

      if (error) {
        throw new Error(`Failed to get orders by status: ${error.message}`);
      }

      // Return data directly since Supabase handles JSONB automatically
      return data || [];
    } catch (error) {
      this.logger.error("Failed to get orders by status", {
        status,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getActiveOrders(): Promise<OrderRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from("orders")
        .select("*")
        .in("status", [
          "pending",
          "auction_active",
          "bid_accepted",
          "processing",
          "active",
          "submitted",
          "claimed",
        ])
        .order("createdAt", { ascending: false });

      if (error) {
        throw new Error(`Failed to get active orders: ${error.message}`);
      }

      this.logger.debug("Retrieved active orders from database", {
        count: data?.length || 0,
        statuses: [...new Set((data || []).map(order => order.status))],
      });

      return data || [];
    } catch (error) {
      this.logger.error("Failed to get active orders", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getOrdersByPhases(phases: string[]): Promise<OrderRecord[]> {
    try {
      // First, try to query with the phase column
      const { data, error } = await this.supabase
        .from("orders")
        .select("*")
        .in("phase", phases)
        .order("createdAt", { ascending: false });

      if (error) {
        // Check if error is due to missing phase column
        if (error.message.includes("column orders.phase does not exist")) {
          this.logger.warn(
            "Phase column does not exist, falling back to status-based query",
            {
              phases,
              error: error.message,
            }
          );

          // Fallback: query by status instead of phase for backwards compatibility
          return await this.getActiveOrdersByStatus();
        }
        throw new Error(`Failed to get orders by phases: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      this.logger.error("Failed to get orders by phases", {
        phases,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Fallback method for when phase column doesn't exist
  private async getActiveOrdersByStatus(): Promise<OrderRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from("orders")
        .select("*")
        .in("status", [
          "pending",
          "auction_active",
          "bid_accepted",
          "processing",
        ])
        .order("createdAt", { ascending: false });

      if (error) {
        throw new Error(
          `Failed to get active orders by status: ${error.message}`
        );
      }

      this.logger.info("Retrieved orders using status fallback", {
        count: data?.length || 0,
      });

      return data || [];
    } catch (error) {
      this.logger.error("Failed to get active orders by status", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Resolver management methods
  async createOrUpdateResolver(resolver: ResolverRecord): Promise<void> {
    try {
      const { error } = await this.supabase.from("resolvers").upsert([
        {
          ...resolver,
          updatedAt: Date.now(),
        },
      ]);

      if (error) {
        throw new Error(`Failed to create/update resolver: ${error.message}`);
      }

      this.logger.info("Resolver created/updated", {
        address: resolver.address,
        reputation: resolver.reputation,
      });
    } catch (error) {
      this.logger.error("Failed to create/update resolver", {
        address: resolver.address,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getResolver(address: string): Promise<ResolverRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from("resolvers")
        .select("*")
        .eq("address", address)
        .single();

      if (error && error.code !== "PGRST116") {
        throw new Error(`Failed to get resolver: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      this.logger.error("Failed to get resolver", {
        address,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getQualifiedResolvers(): Promise<ResolverRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from("resolvers")
        .select("*")
        .eq("isKyc", true)
        .order("reputation", { ascending: false });

      if (error) {
        throw new Error(`Failed to get qualified resolvers: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      this.logger.error("Failed to get qualified resolvers", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details?: string;
  }> {
    try {
      const { error } = await this.supabase
        .from("orders")
        .select("orderHash")
        .limit(1);

      if (error) {
        return {
          status: "unhealthy",
          details: `Database connection error: ${error.message}`,
        };
      }

      return { status: "healthy" };
    } catch (error) {
      return {
        status: "unhealthy",
        details: `Database health check failed: ${(error as Error).message}`,
      };
    }
  }

  // Store prepared order with full details
  async storePreparedOrder(
    orderHash: string,
    fusionOrder: any,
    orderDetails: any
  ): Promise<void> {
    try {
      // Custom replacer to handle BigInt serialization
      const bigIntReplacer = (key: string, value: any) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };

      const preparedOrderRecord = {
        orderHash,
        fusionOrder: JSON.stringify(fusionOrder, bigIntReplacer), // Store the full SDK order
        orderDetails: JSON.stringify(orderDetails, bigIntReplacer), // Store order preparation details
        status: "prepared",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const { error } = await this.supabase
        .from("prepared_orders")
        .insert([preparedOrderRecord]);

      if (error) {
        throw new Error(`Failed to store prepared order: ${error.message}`);
      }

      this.logger.info("Prepared order stored in database", {
        orderHash,
      });
    } catch (error) {
      this.logger.error("Failed to store prepared order", {
        orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Store signed order (alternative to createOrder for complex objects)
  async storeSignedOrder(order: FusionOrder): Promise<void> {
    try {
      // Use the existing createOrder method
      await this.createOrder(order);

      this.logger.info("Signed order stored successfully", {
        orderHash: order.orderHash,
        maker: order.maker,
      });
    } catch (error) {
      this.logger.error("Failed to store signed order", {
        orderHash: order.orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Retrieve prepared order by hash
  async getPreparedOrder(
    orderHash: string
  ): Promise<{ fusionOrder: any; orderDetails: any } | null> {
    try {
      const { data, error } = await this.supabase
        .from("prepared_orders")
        .select("*")
        .eq("orderHash", orderHash)
        .single();

      if (error && error.code !== "PGRST116") {
        throw new Error(`Failed to get prepared order: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      return {
        fusionOrder: JSON.parse(data.fusionOrder),
        orderDetails: JSON.parse(data.orderDetails),
      };
    } catch (error) {
      this.logger.error("Failed to get prepared order", {
        orderHash,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
