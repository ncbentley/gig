UPDATE "tier_entitlements"
SET "features" = "features" || '["signals.levels"]'::jsonb
WHERE "features" @> '["signals.core"]'::jsonb
  AND NOT ("features" @> '["signals.levels"]'::jsonb);
