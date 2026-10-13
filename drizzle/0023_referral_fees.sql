ALTER TABLE "users" ADD COLUMN "referral_code" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "referral_fees" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"payment_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"voided_cents" integer DEFAULT 0 NOT NULL,
	"referrer_tier" text NOT NULL,
	"customer_tier" text NOT NULL,
	"capped_tier" text NOT NULL,
	"customer_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_fees_payment_key_unique" UNIQUE("payment_key")
);
--> statement-breakpoint
ALTER TABLE "referral_fees" ADD CONSTRAINT "referral_fees_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "referral_fees" ADD CONSTRAINT "referral_fees_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "referral_fees_referrer_user_idx" ON "referral_fees" USING btree ("referrer_user_id");
--> statement-breakpoint
CREATE TABLE "referral_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"fee_id" text NOT NULL,
	"external_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"voided_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_adjustments_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "referral_adjustments" ADD CONSTRAINT "referral_adjustments_fee_id_referral_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."referral_fees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "referral_withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "referral_withdrawals" ADD CONSTRAINT "referral_withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "referral_withdrawals_user_idx" ON "referral_withdrawals" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "referral_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"withdrawal_id" text NOT NULL,
	"fee_id" text NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_allocations" ADD CONSTRAINT "referral_allocations_withdrawal_id_referral_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."referral_withdrawals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "referral_allocations" ADD CONSTRAINT "referral_allocations_fee_id_referral_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."referral_fees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "referral_payout_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"account_holder_name" text NOT NULL,
	"routing_encrypted" text NOT NULL,
	"account_encrypted" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_payout_accounts" ADD CONSTRAINT "referral_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
