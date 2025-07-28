// Global type declarations for modules that might not have types

declare module "node-cron" {
  export interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy(): void;
  }

  export function schedule(
    cronExpression: string,
    func: () => void,
    options?: {
      scheduled?: boolean;
      timezone?: string;
    }
  ): ScheduledTask;
}

// Extend global NodeJS types if needed
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      NODE_ENV?: "development" | "staging" | "production" | "test";
      LOG_LEVEL?: "debug" | "info" | "warn" | "error";
      SUPPORTED_CHAINS?: string;
      MAX_ACTIVE_ORDERS?: string;
      ENABLE_PARTIAL_FILLS?: string;
      ETHEREUM_RPC_URL?: string;
      NEAR_RPC_URL?: string;
      EVM_PRIVATE_KEY?: string;
      NEAR_PRIVATE_KEY?: string;
      REDIS_HOST?: string;
      REDIS_PORT?: string;
      REDIS_PASSWORD?: string;
      REDIS_DB?: string;
    }
  }
}

export {};
