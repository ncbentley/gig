UPDATE "plans" SET "amount_cents" = 3300, "active" = true WHERE "tier" = 'basic' AND "period" = 'monthly';
--> statement-breakpoint
UPDATE "plans" SET "amount_cents" = 6600, "active" = true WHERE "tier" = 'silver' AND "period" = 'monthly';
--> statement-breakpoint
UPDATE "plans" SET "amount_cents" = 9900, "active" = true WHERE "tier" = 'gold' AND "period" = 'monthly';
--> statement-breakpoint
UPDATE "plans" SET "active" = false WHERE "period" <> 'monthly';
