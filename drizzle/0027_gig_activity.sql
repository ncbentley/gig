CREATE TABLE "gig_activity_events" (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "last_error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
