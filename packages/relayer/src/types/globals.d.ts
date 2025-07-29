// Global type declarations for modules that might not have types

// Extend global NodeJS types if needed
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      NODE_ENV?: "development" | "staging" | "production" | "test";
      LOG_LEVEL?: "debug" | "info" | "warn" | "error";
      SUPPORTED_CHAINS?: string;
      ENABLE_PARTIAL_FILLS?: string;
      ETHEREUM_RPC_URL?: string;
      NEAR_RPC_URL?: string;
      EVM_PRIVATE_KEY?: string;
      NEAR_PRIVATE_KEY?: string;
      SUPABASE_URL?: string;
      SUPABASE_ANON_KEY?: string;
    }
  }
}

export {};
