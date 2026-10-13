CREATE TABLE "access_passes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "provider_payment_id" text NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "access_passes_provider_payment_id_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
ALTER TABLE "access_passes" ADD CONSTRAINT "access_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "access_passes_user_idx" ON "access_passes" USING btree ("user_id");
