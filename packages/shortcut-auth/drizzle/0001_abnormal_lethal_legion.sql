CREATE TABLE "smart_wallet" (
	"user_id" text PRIMARY KEY NOT NULL,
	"signer_private_key" text NOT NULL,
	"smart_account_address" text NOT NULL,
	"chain_id" integer DEFAULT 11155111 NOT NULL,
	"kernel_version" text DEFAULT 'v3.1' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "smart_wallet" ADD CONSTRAINT "smart_wallet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;