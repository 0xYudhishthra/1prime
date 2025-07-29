-- 1Prime Relayer Service Database Schema
-- Run this in your Supabase SQL editor to create the necessary tables

-- Orders table for storing Fusion orders and their states
CREATE TABLE orders (
  "orderHash" TEXT PRIMARY KEY,
  "maker" TEXT NOT NULL,
  "sourceChain" TEXT NOT NULL,
  "destinationChain" TEXT NOT NULL,
  "sourceToken" TEXT NOT NULL,
  "destinationToken" TEXT NOT NULL,
  "sourceAmount" TEXT NOT NULL,
  "destinationAmount" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "timeout" BIGINT NOT NULL,
  "auctionStartTime" BIGINT NOT NULL,
  "auctionDuration" BIGINT NOT NULL,
  "initialRateBump" INTEGER NOT NULL,
  "signature" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  -- Dynamic HTLC contract addresses (set by resolver during Phase 2)
  "sourceChainHtlcAddress" TEXT,
  "destinationChainHtlcAddress" TEXT,
  "createdAt" BIGINT NOT NULL,
  "status" TEXT NOT NULL CHECK (status IN ('pending', 'auction_active', 'bid_accepted', 'escrow_created', 'completed', 'cancelled', 'expired')),
  "updatedAt" BIGINT NOT NULL,
  "auctionState" JSONB,
  "events" JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- SDK-extracted fields (from 1inch Fusion+ SDK CrossChainOrder)
  "receiver" TEXT, -- Receiver address (if different from maker)
  "srcSafetyDeposit" TEXT, -- Safety deposit on source chain (wei/smallest unit)
  "dstSafetyDeposit" TEXT, -- Safety deposit on destination chain (wei/smallest unit)
  "detailedTimeLocks" JSONB, -- Granular timelock phases (A1-A5, B1-B4)
  "enhancedAuctionDetails" JSONB, -- Enhanced auction with price curve points
  "sourceEscrowDeployedAt" BIGINT, -- When source escrow deployed (E1) - critical for timelock calculation
  "destinationEscrowDeployedAt" BIGINT, -- When destination escrow deployed (E2) - critical for timelock calculation
  
  -- Indexes for efficient querying
  CONSTRAINT valid_chain_pair CHECK (
    "sourceChain" != "destinationChain" AND
    ("sourceChain" IN ('ethereum', 'base', 'bsc', 'polygon', 'arbitrum', 'near', 'near-testnet')) AND
    ("destinationChain" IN ('ethereum', 'base', 'bsc', 'polygon', 'arbitrum', 'near', 'near-testnet'))
  )
);

-- Resolvers table for basic resolver information
CREATE TABLE resolvers (
  "address" TEXT PRIMARY KEY,
  "isKyc" BOOLEAN NOT NULL DEFAULT false,
  "reputation" INTEGER NOT NULL DEFAULT 0 CHECK (reputation >= 0 AND reputation <= 100),
  "completedOrders" INTEGER NOT NULL DEFAULT 0,
  "lastActivity" BIGINT NOT NULL,
  "createdAt" BIGINT NOT NULL DEFAULT EXTRACT(epoch FROM now()) * 1000,
  "updatedAt" BIGINT NOT NULL DEFAULT EXTRACT(epoch FROM now()) * 1000
);

-- Create indexes for efficient querying
CREATE INDEX idx_orders_status ON orders("status");
CREATE INDEX idx_orders_source_chain ON orders("sourceChain");
CREATE INDEX idx_orders_destination_chain ON orders("destinationChain");
CREATE INDEX idx_orders_created_at ON orders("createdAt");
CREATE INDEX idx_orders_timeout ON orders("timeout");
CREATE INDEX idx_orders_auction_start ON orders("auctionStartTime");
-- Indexes for dynamic HTLC contract addresses (for tracking per-swap contracts)
CREATE INDEX idx_orders_source_htlc ON orders("sourceChainHtlcAddress");
CREATE INDEX idx_orders_destination_htlc ON orders("destinationChainHtlcAddress");

-- Indexes for SDK-extracted fields (for enhanced timelock and safety deposit tracking)
CREATE INDEX idx_orders_source_escrow_deployed ON orders("sourceEscrowDeployedAt");
CREATE INDEX idx_orders_destination_escrow_deployed ON orders("destinationEscrowDeployedAt");
CREATE INDEX idx_orders_src_safety_deposit ON orders("srcSafetyDeposit");
CREATE INDEX idx_orders_dst_safety_deposit ON orders("dstSafetyDeposit");

CREATE INDEX idx_resolvers_kyc ON resolvers("isKyc");
CREATE INDEX idx_resolvers_reputation ON resolvers("reputation");
CREATE INDEX idx_resolvers_last_activity ON resolvers("lastActivity");

-- RLS (Row Level Security) policies for secure access
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolvers ENABLE ROW LEVEL SECURITY;

-- Policy to allow read access to orders (public information)
CREATE POLICY "Orders are viewable by everyone" ON orders
  FOR SELECT USING (true);

-- Policy to allow insert of new orders
CREATE POLICY "Orders can be created by authenticated users" ON orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Policy to allow updates to orders (for status changes)
CREATE POLICY "Orders can be updated by authenticated users" ON orders
  FOR UPDATE USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Policy to allow read access to resolvers (public KYC information)
CREATE POLICY "Resolvers are viewable by everyone" ON resolvers
  FOR SELECT USING (true);

-- Policy to allow resolver registration and updates
CREATE POLICY "Resolvers can be created and updated" ON resolvers
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = EXTRACT(epoch FROM now()) * 1000;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update the updatedAt timestamp
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_resolvers_updated_at
  BEFORE UPDATE ON resolvers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data (optional, for testing)
-- Sample resolvers
-- INSERT INTO resolvers ("address", "isKyc", "reputation", "lastActivity") VALUES
-- ('0x742d35Cc6635C0532925a3b8D4A8f4c3c8a54a0b', true, 95, EXTRACT(epoch FROM now()) * 1000),
-- ('0x8ba1f109551bD432803012645Hac136c69d80Ba9', true, 98, EXTRACT(epoch FROM now()) * 1000);

-- Sample order (HTLC addresses start as NULL, populated by resolver during Phase 2)
-- INSERT INTO orders (
--   "orderHash", "maker", "sourceChain", "destinationChain", 
--   "sourceToken", "destinationToken", "sourceAmount", "destinationAmount",
--   "secretHash", "timeout", "auctionStartTime", "auctionDuration", 
--   "initialRateBump", "signature", "nonce", "createdAt", "updatedAt"
-- ) VALUES (
--   '0x1234567890abcdef...', '0x1234567890abcdef1234567890abcdef12345678',
--   'ethereum', 'near', '0x0000000000000000000000000000000000000000',
--   'wrap.near', '1000000000000000000', '5000000000000000000000000',
--   '0xabcdef1234567890...', EXTRACT(epoch FROM now() + interval '1 hour') * 1000,
--   EXTRACT(epoch FROM now()) * 1000, 120000, 1000,
--   '0xsignature...', 'nonce123', EXTRACT(epoch FROM now()) * 1000,
--   EXTRACT(epoch FROM now()) * 1000
-- );

-- To update HTLC addresses during Phase 2 (when resolver deploys contracts):
-- UPDATE orders 
-- SET "sourceChainHtlcAddress" = '0x...', 
--     "destinationChainHtlcAddress" = 'htlc.contract.near',
--     "updatedAt" = EXTRACT(epoch FROM now()) * 1000
-- WHERE "orderHash" = '0x1234567890abcdef...';

-- View for active orders (convenience)
CREATE VIEW active_orders AS
SELECT * FROM orders 
WHERE status IN ('pending', 'auction_active', 'bid_accepted', 'escrow_created')
ORDER BY "createdAt" DESC;

-- View for completed orders statistics
CREATE VIEW order_stats AS
SELECT 
  "sourceChain",
  "destinationChain",
  COUNT(*) as total_orders,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
  COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
  COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_orders,
  AVG(CASE WHEN status = 'completed' THEN ("updatedAt" - "createdAt") END) as avg_completion_time_ms
FROM orders 
GROUP BY "sourceChain", "destinationChain";

-- View for resolver performance metrics
CREATE VIEW resolver_stats AS
SELECT 
  r."address",
  r."reputation",
  r."completedOrders",
  COUNT(o."orderHash") as total_bids,
  COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as successful_orders,
  CASE 
    WHEN COUNT(o."orderHash") > 0 THEN 
      (COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::float / COUNT(o."orderHash")::float) * 100
    ELSE 0 
  END as success_rate
FROM resolvers r
LEFT JOIN orders o ON o."auctionState"->>'winningResolver' = r."address"
WHERE r."isKyc" = true
GROUP BY r."address", r."reputation", r."completedOrders"
ORDER BY success_rate DESC, r."reputation" DESC; 