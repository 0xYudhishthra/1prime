-- 1Prime Relayer Database Cleanup Script
-- Run this in your Supabase SQL editor to remove all existing tables and views

-- First, drop all views (since they depend on tables)
DROP VIEW IF EXISTS resolver_stats CASCADE;
DROP VIEW IF EXISTS order_stats CASCADE;
DROP VIEW IF EXISTS active_orders CASCADE;

-- Drop triggers first
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
DROP TRIGGER IF EXISTS update_resolvers_updated_at ON resolvers;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Drop tables (this will also drop all policies automatically)
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS resolvers CASCADE;

-- Optional: Reset the database schema completely
-- This removes any custom types or other objects
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- GRANT ALL ON SCHEMA public TO postgres;
-- GRANT ALL ON SCHEMA public TO public; 