ALTER TABLE "app"."support_session" ADD COLUMN "admin_display_name" text NOT NULL;--> statement-breakpoint
GRANT INSERT (admin_display_name) ON app.support_session TO admin_user;
--> statement-breakpoint
-- Replay (I4) resets the attempt counter so the event gets a fresh retry budget.
GRANT UPDATE (attempts) ON app.webhook_event TO admin_user;
--> statement-breakpoint
-- The display name is part of the immutable session record.
CREATE OR REPLACE FUNCTION app.support_session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_at := now();
    NEW.expires_at := NEW.started_at + interval '60 minutes';
    NEW.ended_at := NULL;
    NEW.end_reason := NULL;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY: support session already ended' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.admin_user_id, NEW.admin_display_name, NEW.business_id, NEW.reason, NEW.started_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.admin_user_id, OLD.admin_display_name, OLD.business_id, OLD.reason, OLD.started_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'APPEND_ONLY: support session fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
