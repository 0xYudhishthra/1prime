ALTER TABLE "smart_wallet" RENAME COLUMN "signer_private_key" TO "evm_signer_private_key";--> statement-breakpoint
ALTER TABLE "smart_wallet" RENAME COLUMN "smart_account_address" TO "evm_smart_account_address";--> statement-breakpoint
ALTER TABLE "smart_wallet" RENAME COLUMN "chain_id" TO "evm_chain_id";--> statement-breakpoint
ALTER TABLE "smart_wallet" RENAME COLUMN "kernel_version" TO "evm_kernel_version";--> statement-breakpoint
ALTER TABLE "smart_wallet" ADD COLUMN "near_account_id" text;--> statement-breakpoint
ALTER TABLE "smart_wallet" ADD COLUMN "near_keypair" text;