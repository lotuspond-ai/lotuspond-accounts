CREATE TABLE "hydra_sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hydra_sessions" ADD CONSTRAINT "hydra_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hydra_sessions_account_idx" ON "hydra_sessions" USING btree ("account_id");