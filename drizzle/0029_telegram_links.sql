CREATE TABLE "telegram_links" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "telegram_user_id" text NOT NULL,
  "telegram_username" text,
  "auth_date" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_active_user" ON "telegram_links" ("user_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_active_telegram" ON "telegram_links" ("telegram_user_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;
