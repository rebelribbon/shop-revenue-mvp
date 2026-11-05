-- Technician role: techs work assigned jobs; staff run the front office; owner runs the shop.
ALTER TABLE app.membership DROP CONSTRAINT IF EXISTS membership_role_check;
--> statement-breakpoint
ALTER TABLE app.membership ADD CONSTRAINT membership_role_check
  CHECK (role IN ('owner', 'staff', 'technician'));
--> statement-breakpoint
-- Staff and technicians share the 10-seat team cap.
CREATE OR REPLACE FUNCTION app.membership_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  active_count int;
  seat_count int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.business_id <> OLD.business_id OR NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'IMMUTABLE: membership business_id and role cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'IMMUTABLE: membership user_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'invited' AND NEW.status IN ('active', 'removed'))
      OR (OLD.status = 'active' AND NEW.status = 'removed')) THEN
      PERFORM app.raise_invalid_transition('membership', OLD.status, NEW.status);
    END IF;
  ELSIF NEW.status = 'removed' THEN
    PERFORM app.raise_invalid_transition('membership', '(new)', NEW.status);
  END IF;

  IF NEW.status = 'active' THEN
    NEW.activated_at := coalesce(NEW.activated_at, now());
    NEW.invite_token_hash := NULL;
  ELSIF NEW.status = 'removed' THEN
    NEW.removed_at := coalesce(NEW.removed_at, now());
    NEW.invite_token_hash := NULL;
  END IF;

  IF NEW.role IN ('staff', 'technician') AND NEW.status IN ('invited', 'active') AND TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('app.membership:' || NEW.business_id::text, 0));
    SELECT count(*) INTO seat_count FROM app.membership
     WHERE business_id = NEW.business_id AND role IN ('staff', 'technician')
       AND status IN ('invited', 'active') AND id <> NEW.id;
    IF seat_count >= 10 THEN
      RAISE EXCEPTION 'MEMBERSHIP_LIMIT: a business has at most 10 team logins' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('app.membership:' || NEW.business_id::text, 0));
    SELECT count(*) INTO active_count FROM app.membership
     WHERE business_id = NEW.business_id AND status = 'active' AND id <> NEW.id;
    IF active_count >= 11 THEN
      RAISE EXCEPTION 'MEMBERSHIP_LIMIT: a business has at most 11 active members' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
