CREATE TABLE "directory" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"product" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "directory_account_idx" ON "directory" USING btree ("account_id");