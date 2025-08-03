-- 1Prime Relayer Service Database Schema
-- Run this in your Supabase SQL editor to create the necessary tables
--
-- SIMPLIFIED ORDER FLOW:
-- 1. User calls /orders/prepare -> order stored in prepared_orders table
-- 2. User signs the orderHash and calls /orders/submit with orderHash + signature
-- 3. Relayer retrieves full order details from prepared_orders table
-- 4. Order is processed and stored in main orders table

-- Orders table for storing Fusion orders and their states
CREATE TABLE orders (
  "orderHash" TEXT PRIMARY KEY,
  "maker" TEXT NOT NULL,
  "userSrcAddress" TEXT NOT NULL, -- User address on source chain
  "userDstAddress" TEXT NOT NULL, -- User address on destination chain
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
  "createdAt" BIGINT NOT NULL,
  "status" TEXT NOT NULL CHECK (status IN ('pending', 'auction_active', 'bid_accepted', 'escrow_created', 'completed', 'cancelled', 'expired')),
  "phase" TEXT DEFAULT 'submitted' CHECK (phase IN ('submitted', 'claimed', 'src_escrow_deployed', 'dst_escrow_deployed', 'waiting-for-secret', 'completed', 'cancelled')),
  "assignedResolver" TEXT, -- Address of the resolver assigned to process this order
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
  
  -- Escrow contract information
  "srcEscrowAddress" TEXT, -- Source chain escrow contract address
  "dstEscrowAddress" TEXT, -- Destination chain escrow contract address
  "srcEscrowTxHash" TEXT, -- Source escrow deployment transaction hash
  "dstEscrowTxHash" TEXT, -- Destination escrow deployment transaction hash
  "srcEscrowBlockNumber" BIGINT, -- Source escrow deployment block number
  "dstEscrowBlockNumber" BIGINT, -- Destination escrow deployment block number
  
  -- NEAR address compatibility fields for cross-chain support
  "originalAddresses" JSONB, -- Original addresses (for NEAR compatibility): {userAddress, fromToken, toToken, escrowFactory}
  "processedAddresses" JSONB, -- Processed addresses (EVM placeholders): {userAddress, fromToken, toToken, escrowFactory}
  "nearAddressMappings" JSONB, -- EVM placeholder -> original NEAR address mappings
  
  -- Indexes for efficient querying
  CONSTRAINT valid_chain_pair CHECK (
    "sourceChain" != "destinationChain" AND
    ("sourceChain" IN ('ethereum', 'base', 'bsc', 'polygon', 'arbitrum', 'near', 'near-testnet')) AND
    ("destinationChain" IN ('ethereum', 'base', 'bsc', 'polygon', 'arbitrum', 'near', 'near-testnet'))
  )
);

-- Prepared orders table for storing full order details during preparation phase
-- This supports the simplified flow where users only need orderHash + signature to submit
CREATE TABLE prepared_orders (
  "orderHash" TEXT PRIMARY KEY,
  "fusionOrder" TEXT NOT NULL, -- JSON string of the full SDK CrossChainOrder object
  "orderDetails" TEXT NOT NULL, -- JSON string of order preparation details
  "status" TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'submitted', 'expired')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "expiresAt" BIGINT -- Optional expiration time for prepared orders
  
  -- Note: No foreign key to orders table since prepared_orders are created BEFORE orders
);



-- Create indexes for efficient querying
CREATE INDEX idx_orders_status ON orders("status");
CREATE INDEX idx_orders_phase ON orders("phase");
CREATE INDEX idx_orders_assigned_resolver ON orders("assignedResolver");
CREATE INDEX idx_orders_source_chain ON orders("sourceChain");
CREATE INDEX idx_orders_destination_chain ON orders("destinationChain");
CREATE INDEX idx_orders_created_at ON orders("createdAt");
CREATE INDEX idx_orders_timeout ON orders("timeout");
CREATE INDEX idx_orders_auction_start ON orders("auctionStartTime");

-- Indexes for SDK-extracted fields (for enhanced timelock and safety deposit tracking)
CREATE INDEX idx_orders_source_escrow_deployed ON orders("sourceEscrowDeployedAt");
CREATE INDEX idx_orders_destination_escrow_deployed ON orders("destinationEscrowDeployedAt");
CREATE INDEX idx_orders_src_safety_deposit ON orders("srcSafetyDeposit");
CREATE INDEX idx_orders_dst_safety_deposit ON orders("dstSafetyDeposit");

-- Indexes for escrow contract information
CREATE INDEX idx_orders_src_escrow_address ON orders("srcEscrowAddress");
CREATE INDEX idx_orders_dst_escrow_address ON orders("dstEscrowAddress");
CREATE INDEX idx_orders_src_escrow_tx ON orders("srcEscrowTxHash");
CREATE INDEX idx_orders_dst_escrow_tx ON orders("dstEscrowTxHash");

-- Indexes for prepared_orders table
CREATE INDEX idx_prepared_orders_status ON prepared_orders("status");
CREATE INDEX idx_prepared_orders_created_at ON prepared_orders("createdAt");
CREATE INDEX idx_prepared_orders_expires_at ON prepared_orders("expiresAt");

-- RLS (Row Level Security) policies for secure access
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepared_orders ENABLE ROW LEVEL SECURITY;

-- Policy to allow read access to orders (public information)
CREATE POLICY "Orders are viewable by everyone" ON orders
  FOR SELECT USING (true);

-- Policy to allow insert of new orders
CREATE POLICY "Orders can be created by authenticated users" ON orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Policy to allow updates to orders (for status changes)
CREATE POLICY "Orders can be updated by authenticated users" ON orders
  FOR UPDATE USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Policies for prepared_orders table
CREATE POLICY "Prepared orders are viewable by everyone" ON prepared_orders
  FOR SELECT USING (true);

CREATE POLICY "Prepared orders can be created by authenticated users" ON prepared_orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Prepared orders can be updated by authenticated users" ON prepared_orders
  FOR UPDATE USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

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

CREATE TRIGGER update_prepared_orders_updated_at
  BEFORE UPDATE ON prepared_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data (optional, for testing)

-- Sample order
-- INSERT INTO orders (
--   "orderHash", "maker", "sourceChain", "destinationChain", 
--   "sourceToken", "destinationToken", "sourceAmount", "destinationAmount",
--   "secretHash", "timeout", "auctionStartTime", "auctionDuration", 
--   "initialRateBump", "signature", "nonce", "createdAt", "status", "updatedAt"
-- ) VALUES (
--   '0x1234567890abcdef...', '0x1234567890abcdef1234567890abcdef12345678',
--   'ethereum', 'near', '0x0000000000000000000000000000000000000000',
--   'wrap.near', '1000000000000000000', '5000000000000000000000000',
--   '0xabcdef1234567890...', EXTRACT(epoch FROM now() + interval '1 hour') * 1000,
--   EXTRACT(epoch FROM now()) * 1000, 120000, 1000,
--   '0xsignature...', 'nonce123', EXTRACT(epoch FROM now()) * 1000,
--   'pending', EXTRACT(epoch FROM now()) * 1000
-- );

-- View for active orders (convenience)
CREATE VIEW active_orders AS
SELECT * FROM orders 
WHERE status IN ('pending', 'auction_active', 'bid_accepted', 'escrow_created')
   OR phase IN ('submitted', 'claimed', 'src_escrow_deployed', 'dst_escrow_deployed', 'waiting-for-secret')
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