CREATE TABLE "research_feed_log" (
  "seq" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "entity" text NOT NULL,
  "entity_id" text NOT NULL,
  "op" text NOT NULL,
  "snapshot" jsonb,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "research_feed_log" ("entity", "entity_id", "op", "snapshot", "occurred_at")
SELECT 'signal', "id", 'upsert', to_jsonb("signals"), "updated_at" FROM "signals";
--> statement-breakpoint
INSERT INTO "research_feed_log" ("entity", "entity_id", "op", "snapshot", "occurred_at")
SELECT 'idea', "id", 'upsert', to_jsonb("consolidated_ideas"), "updated_at" FROM "consolidated_ideas";
--> statement-breakpoint
INSERT INTO "research_feed_log" ("entity", "entity_id", "op", "snapshot", "occurred_at")
SELECT 'gold', "id", 'upsert', to_jsonb("gold_book_entries"), "created_at" FROM "gold_book_entries";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION research_feed_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO research_feed_log (entity, entity_id, op, snapshot)
    VALUES (TG_ARGV[0], OLD.id, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  INSERT INTO research_feed_log (entity, entity_id, op, snapshot)
  VALUES (TG_ARGV[0], NEW.id, 'upsert', to_jsonb(NEW));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION research_feed_log_signal_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sid := OLD.signal_id;
  ELSE
    sid := NEW.signal_id;
  END IF;
  INSERT INTO research_feed_log (entity, entity_id, op, snapshot)
  VALUES ('signal', sid, 'upsert', NULL);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER research_feed_log_signals
AFTER INSERT OR UPDATE OR DELETE ON signals
FOR EACH ROW EXECUTE FUNCTION research_feed_log_change('signal');
--> statement-breakpoint
CREATE TRIGGER research_feed_log_ideas
AFTER INSERT OR UPDATE OR DELETE ON consolidated_ideas
FOR EACH ROW EXECUTE FUNCTION research_feed_log_change('idea');
--> statement-breakpoint
CREATE TRIGGER research_feed_log_gold
AFTER INSERT OR UPDATE OR DELETE ON gold_book_entries
FOR EACH ROW EXECUTE FUNCTION research_feed_log_change('gold');
--> statement-breakpoint
CREATE TRIGGER research_feed_log_signal_targets
AFTER INSERT OR UPDATE OR DELETE ON signal_targets
FOR EACH ROW EXECUTE FUNCTION research_feed_log_signal_touch();
--> statement-breakpoint
CREATE TRIGGER research_feed_log_signal_adjustments
AFTER INSERT OR UPDATE OR DELETE ON signal_adjustments
FOR EACH ROW EXECUTE FUNCTION research_feed_log_signal_touch();
--> statement-breakpoint
CREATE TRIGGER research_feed_log_signal_outcomes
AFTER INSERT OR UPDATE OR DELETE ON signal_outcomes
FOR EACH ROW EXECUTE FUNCTION research_feed_log_signal_touch();
