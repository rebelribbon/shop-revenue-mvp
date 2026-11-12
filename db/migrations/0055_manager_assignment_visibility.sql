-- Manager capabilities and assignment-scoped customer/task visibility.
-- Manager is a staff login with explicit can_manage_team permission.
ALTER TABLE app.membership
  ADD COLUMN can_manage_team boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE app.membership
  ADD CONSTRAINT membership_manager_is_staff_check
  CHECK (NOT can_manage_team OR role = 'staff');
--> statement-breakpoint
GRANT UPDATE (role, can_manage_team) ON app.membership TO app_user;
--> statement-breakpoint
ALTER TABLE app.customer
  ADD COLUMN assigned_user_id uuid REFERENCES app."user"(id);
--> statement-breakpoint
ALTER TABLE app.task
  ADD COLUMN assigned_user_id uuid REFERENCES app."user"(id);
--> statement-breakpoint
CREATE INDEX customer_assigned_idx ON app.customer (business_id, assigned_user_id);
--> statement-breakpoint
CREATE INDEX task_assigned_open_idx ON app.task (business_id, assigned_user_id, due_on)
 WHERE done_at IS NULL;
--> statement-breakpoint
-- Existing staff-created records retain their creator when they are active team members.
UPDATE app.customer c
SET assigned_user_id = c.created_by_user_id
WHERE c.created_by_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.business_id = c.business_id AND m.user_id = c.created_by_user_id
      AND m.status = 'active' AND m.role = 'staff'
  );
--> statement-breakpoint
UPDATE app.task t
SET assigned_user_id = t.created_by_user_id
WHERE t.created_by_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.business_id = t.business_id AND m.user_id = t.created_by_user_id
      AND m.status = 'active' AND m.role = 'staff'
  );
--> statement-breakpoint
GRANT UPDATE (assigned_user_id) ON app.customer, app.task TO app_user;
--> statement-breakpoint

-- A person may only change their role/manager privilege via the shop management
-- authorization path. Old members' user IDs and the owner identity stay immutable.
CREATE OR REPLACE FUNCTION app.membership_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  active_count int;
  seat_count int;
  can_admin boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.business_id <> OLD.business_id THEN
      RAISE EXCEPTION 'IMMUTABLE: membership business_id cannot change' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'IMMUTABLE: membership user_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.role <> OLD.role AND (OLD.role = 'owner' OR NEW.role = 'owner' OR OLD.status <> 'active') THEN
      RAISE EXCEPTION 'FORBIDDEN: owner role is immutable and only active team roles can change' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'invited' AND NEW.status IN ('active', 'removed'))
      OR (OLD.status = 'active' AND NEW.status = 'removed')) THEN
      PERFORM app.raise_invalid_transition('membership', OLD.status, NEW.status);
    END IF;

    IF (NEW.role, NEW.can_manage_team) IS DISTINCT FROM (OLD.role, OLD.can_manage_team) THEN
      SELECT EXISTS (
        SELECT 1 FROM app.membership acting
        WHERE acting.business_id = NEW.business_id
          AND acting.user_id = app.current_actor_id()
          AND acting.status = 'active'
          AND (acting.role = 'owner' OR acting.can_manage_team)
      ) INTO can_admin;
      IF app.current_actor_type() = 'user' AND NOT can_admin THEN
        RAISE EXCEPTION 'FORBIDDEN: only shop management can change team privileges' USING ERRCODE = '42501';
      END IF;
      IF OLD.user_id IS NOT NULL AND OLD.user_id = app.current_actor_id() THEN
        RAISE EXCEPTION 'FORBIDDEN: cannot change your own role' USING ERRCODE = '42501';
      END IF;
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
--> statement-breakpoint

-- In addition to tenant isolation, staff must be assigned to a customer.
-- Technicians may see a customer only while assigned to an RO for that customer.
CREATE POLICY customer_assignment_read ON app.customer
  AS RESTRICTIVE FOR SELECT TO app_user
  USING (
    app.current_actor_type() IS DISTINCT FROM 'user'
    OR EXISTS (
      SELECT 1 FROM app.membership m
      WHERE m.business_id = business_id
        AND m.user_id = app.current_actor_id() AND m.status = 'active'
        AND (m.role = 'owner' OR m.can_manage_team)
    )
    OR assigned_user_id = app.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM app.job_assignment ja
      JOIN app.activity a ON a.business_id = ja.business_id
        AND a.subject_type = 'job' AND a.subject_id = ja.job_id
        AND a.kind = 'job.costed'
      WHERE ja.business_id = business_id AND ja.user_id = app.current_actor_id()
        AND a.data->>'customerId' = id::text
    )
  );
--> statement-breakpoint
CREATE POLICY vehicle_assignment_read ON app.vehicle
  AS RESTRICTIVE FOR SELECT TO app_user
  USING (
    EXISTS (SELECT 1 FROM app.customer c
      WHERE c.business_id = business_id AND c.id = customer_id)
    OR app.current_actor_type() IS DISTINCT FROM 'user'
  );
--> statement-breakpoint
CREATE POLICY task_assignment_read ON app.task
  AS RESTRICTIVE FOR SELECT TO app_user
  USING (
    app.current_actor_type() IS DISTINCT FROM 'user'
    OR assigned_user_id = app.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM app.membership m WHERE m.business_id = business_id
      AND m.user_id = app.current_actor_id() AND m.status = 'active'
      AND (m.role = 'owner' OR m.can_manage_team)
    )
  );
--> statement-breakpoint

-- Assignment changes must not be self-service just because an employee can
-- update a customer's contact details.
CREATE FUNCTION app.assignment_change_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
     AND app.current_actor_type() = 'user'
     AND NOT EXISTS (
       SELECT 1 FROM app.membership m
       WHERE m.business_id = NEW.business_id
       AND m.user_id = app.current_actor_id() AND m.status = 'active'
       AND (m.role = 'owner' OR m.can_manage_team)
     )
  THEN
    RAISE EXCEPTION 'FORBIDDEN: only management can reassign records' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER customer_assignment_guard BEFORE UPDATE OF assigned_user_id
  ON app.customer FOR EACH ROW EXECUTE FUNCTION app.assignment_change_guard();
--> statement-breakpoint
CREATE TRIGGER task_assignment_guard BEFORE UPDATE OF assigned_user_id
  ON app.task FOR EACH ROW EXECUTE FUNCTION app.assignment_change_guard();
