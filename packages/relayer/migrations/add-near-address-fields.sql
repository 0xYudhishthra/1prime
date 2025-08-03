-- Migration: Add NEAR address compatibility fields and user address separation
-- Run this SQL in your Supabase SQL editor to add NEAR address mapping support and separate user addresses

-- Add new columns for separate user addresses and NEAR address compatibility
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS "userSrcAddress" TEXT,
ADD COLUMN IF NOT EXISTS "userDstAddress" TEXT,
ADD COLUMN IF NOT EXISTS "originalAddresses" JSONB,
ADD COLUMN IF NOT EXISTS "processedAddresses" JSONB,
ADD COLUMN IF NOT EXISTS "nearAddressMappings" JSONB;

-- Add comments for documentation
COMMENT ON COLUMN orders."userSrcAddress" IS 'User address on source chain';
COMMENT ON COLUMN orders."userDstAddress" IS 'User address on destination chain';
COMMENT ON COLUMN orders."originalAddresses" IS 'Original addresses for NEAR compatibility: {userSrcAddress, userDstAddress, sourceTokenAddress, destinationTokenAddress, escrowFactory}';
COMMENT ON COLUMN orders."processedAddresses" IS 'Processed addresses (EVM placeholders): {userSrcAddress, userDstAddress, fromToken, toToken, escrowFactory}';  
COMMENT ON COLUMN orders."nearAddressMappings" IS 'EVM placeholder -> original NEAR address mappings';

-- For existing records, copy maker field to userSrcAddress if userSrcAddress is null
-- Note: You may need to manually set userDstAddress for existing orders based on your business logic
UPDATE orders 
SET "userSrcAddress" = "maker" 
WHERE "userSrcAddress" IS NULL AND "maker" IS NOT NULL;

-- Create an index for efficient lookups of NEAR address mappings
CREATE INDEX IF NOT EXISTS idx_orders_near_mappings ON orders USING GIN ("nearAddressMappings");

-- Create indexes for the new address fields
CREATE INDEX IF NOT EXISTS idx_orders_user_src_address ON orders ("userSrcAddress");
CREATE INDEX IF NOT EXISTS idx_orders_user_dst_address ON orders ("userDstAddress");

-- Migration completed successfully
SELECT 'NEAR address compatibility fields and user address separation added successfully' AS status;