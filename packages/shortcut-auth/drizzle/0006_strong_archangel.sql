CREATE TABLE "cross_chain_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"order_hash" text,
	"random_number" text NOT NULL,
	"secret_hash" text NOT NULL,
	"source_chain" text NOT NULL,
	"destination_chain" text NOT NULL,
	"source_token" text NOT NULL,
	"destination_token" text NOT NULL,
	"source_amount" text NOT NULL,
	"destination_amount" text,
	"current_phase" text DEFAULT 'preparing' NOT NULL,
	"relayer_url" text NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"is_successful" boolean,
	"error_message" text,
	"secret_revealed" boolean DEFAULT false NOT NULL,
	"secret_revealed_at" timestamp,
	"order_data" json,
	"signed_order_data" json,
	"status_history" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "cross_chain_order_order_hash_unique" UNIQUE("order_hash")
);
--> statement-breakpoint
ALTER TABLE "cross_chain_order" ADD CONSTRAINT "cross_chain_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;