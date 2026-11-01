ALTER TABLE app.business ADD COLUMN labor_sell_rate_cents integer NOT NULL DEFAULT 0 CHECK(labor_sell_rate_cents BETWEEN 0 AND 100000000);
ALTER TABLE app.business ADD COLUMN labor_cost_rate_cents integer NOT NULL DEFAULT 0 CHECK(labor_cost_rate_cents BETWEEN 0 AND 100000000);
GRANT UPDATE(labor_sell_rate_cents,labor_cost_rate_cents) ON app.business TO app_user;
CREATE TABLE app.expense (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 spent_on date NOT NULL,description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 200),
 category text NOT NULL CHECK(category IN ('rent','tools','supplies','utilities','insurance','marketing','parts','labor','other')),
 amount_cents bigint NOT NULL CHECK(amount_cents<>0 AND abs(amount_cents)<=1000000000),
 included_in_job_cost boolean NOT NULL DEFAULT false,reverses_expense_id uuid,reason text,
 UNIQUE(business_id,id),FOREIGN KEY(business_id,reverses_expense_id) REFERENCES app.expense(business_id,id),
 CHECK((amount_cents>0 AND reverses_expense_id IS NULL) OR (amount_cents<0 AND reverses_expense_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason))>0))
);
SELECT app.apply_tenant_rls('app.expense');
GRANT SELECT,INSERT ON app.expense TO app_user;
GRANT SELECT ON app.expense TO worker_user,admin_user;
CREATE UNIQUE INDEX expense_one_correction ON app.expense(reverses_expense_id) WHERE reverses_expense_id IS NOT NULL;
CREATE INDEX expense_month_idx ON app.expense(business_id,spent_on);
CREATE FUNCTION app.guard_expense() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE original app.expense;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.membership m WHERE m.business_id=NEW.business_id AND m.user_id=app.current_actor_id() AND m.role='owner' AND m.status='active') OR app.current_actor_type()<>'user'
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: only the owner can record expenses'; END IF;
 IF NEW.reverses_expense_id IS NOT NULL THEN
 SELECT * INTO original FROM app.expense WHERE business_id=NEW.business_id AND id=NEW.reverses_expense_id;
 IF NOT FOUND OR original.amount_cents<=0 OR NEW.amount_cents<>-original.amount_cents OR NEW.spent_on<>original.spent_on OR NEW.category<>original.category OR NEW.included_in_job_cost<>original.included_in_job_cost
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: expense correction must exactly reverse the original'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_guard BEFORE INSERT ON app.expense FOR EACH ROW EXECUTE FUNCTION app.guard_expense();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.expense FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.expense FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
CREATE TABLE app.common_job (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),parts jsonb NOT NULL CHECK(jsonb_typeof(parts)='array'),labor jsonb NOT NULL CHECK(jsonb_typeof(labor)='array'),
 active boolean NOT NULL DEFAULT true,UNIQUE(business_id,id)
);
SELECT app.apply_tenant_rls('app.common_job');
GRANT SELECT,INSERT ON app.common_job TO app_user;
GRANT UPDATE(active) ON app.common_job TO app_user;
GRANT SELECT ON app.common_job TO worker_user,admin_user;
CREATE INDEX common_job_active_idx ON app.common_job(business_id,active);
CREATE FUNCTION app.guard_common_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF app.current_actor_type()<>'user' OR NOT EXISTS(SELECT 1 FROM app.membership m WHERE m.business_id=NEW.business_id AND m.user_id=app.current_actor_id() AND m.role='owner' AND m.status='active')
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: only the owner can change common jobs'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('common-jobs:'||NEW.business_id::text,0));
 IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active) AND (SELECT count(*) FROM app.common_job WHERE business_id=NEW.business_id AND active)>=25
 THEN RAISE EXCEPTION 'INVALID_TRANSITION: maximum 25 common jobs'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER common_job_guard BEFORE INSERT OR UPDATE ON app.common_job FOR EACH ROW EXECUTE FUNCTION app.guard_common_job();

ALTER TABLE app.estimate_version ADD COLUMN share_token_ciphertext text;
ALTER TABLE app.invoice ADD COLUMN share_token_ciphertext text;
GRANT UPDATE(share_token_ciphertext) ON app.estimate_version,app.invoice TO app_user;
