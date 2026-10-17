CREATE UNIQUE INDEX "access_passes_one_paid_per_user_idx" ON "access_passes" ("user_id") WHERE "status" = 'paid';
