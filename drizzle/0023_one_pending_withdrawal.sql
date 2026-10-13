CREATE UNIQUE INDEX "referral_withdrawals_one_pending_idx" ON "referral_withdrawals" ("user_id") WHERE "status" = 'pending';
