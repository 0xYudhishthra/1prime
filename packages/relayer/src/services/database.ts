import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "winston";
import {
  FusionOrder,
  OrderStatus,
  OrderEvent,
  DutchAuctionState,
} from "../types";

export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface OrderRecord extends FusionOrder {
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  auctionState?: DutchAuctionState;
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
        sourceChain: order.sourceChain || "",
        destinationChain: order.destinationChain || "",
        sourceToken: order.sourceToken || "",
        destinationToken: order.destinationToken || "",
        sourceAmount: order.sourceAmount || "0",
        destinationAmount: order.destinationAmount || "0",
        secretHash: order.secretHash || "",
        timeout: order.timeout || Date.now() + 3600000,
        auctionStartTime: order.auctionStartTime || Date.now(),
        auctionDuration: order.auctionDuration || 120000,
        initialRateBump: order.initialRateBump || 1000,
        signature: order.signature || "",
        nonce: order.nonce || "",
        sourceChainHtlcAddress: order.sourceChainHtlcAddress || null,
        destinationChainHtlcAddress: order.destinationChainHtlcAddress || null,

        // SDK-extracted fields (match the schema)
        receiver: (order as any).receiver || null,
        srcSafetyDeposit: (order as any).srcSafetyDeposit || null,
        dstSafetyDeposit: (order as any).dstSafetyDeposit || null,

        // Store complex objects in appropriate JSONB columns
        detailedTimeLocks: (order as any).detailedTimeLocks || null,
        enhancedAuctionDetails: (order as any).enhancedAuctionDetails || null,

        // Standard tracking fields
        status: "pending",
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

      const { data, error } = await this.supabase
        .from("orders")
        .insert([orderRecord])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create order: ${error.message}`);
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
    status: OrderStatus,
    auctionState?: DutchAuctionState
  ): Promise<void> {
    try {
      const updateData: Partial<OrderRecord> = {
        status,
        updatedAt: Date.now(),
      };

      if (auctionState) {
        updateData.auctionState = auctionState;
      }

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
        hasAuctionState: !!auctionState,
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
        .in("status", ["pending", "auction_active", "bid_accepted"])
        .order("createdAt", { ascending: false });

      if (error) {
        throw new Error(`Failed to get active orders: ${error.message}`);
      }

      // Return data directly since Supabase handles JSONB automatically
      return data || [];
    } catch (error) {
      this.logger.error("Failed to get active orders", {
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
