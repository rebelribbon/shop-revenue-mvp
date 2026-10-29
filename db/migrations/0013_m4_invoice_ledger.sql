ALTER TABLE app.estimate_version ADD CONSTRAINT estimate_quote_version_ref UNIQUE(business_id,quote_id,id);
ALTER TABLE app.estimate_authorization ADD CONSTRAINT authorization_version_ref UNIQUE(business_id,version_id,id);
CREATE TABLE app.invoice (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 number integer NOT NULL CHECK(number>0), quote_id uuid NOT NULL, version_id uuid NOT NULL, authorization_id uuid NOT NULL,
 customer_id uuid NOT NULL,vehicle_id uuid NOT NULL,snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 total_cents bigint NOT NULL CHECK(total_cents>0 AND total_cents<=9007199254740991),currency text NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 due_on date,invoice_terms text NOT NULL DEFAULT '',voided_at timestamptz,void_reason text,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,number),
 FOREIGN KEY(business_id,quote_id,version_id) REFERENCES app.estimate_version(business_id,quote_id,id),
 FOREIGN KEY(business_id,version_id,authorization_id) REFERENCES app.estimate_authorization(business_id,version_id,id),
 FOREIGN KEY(business_id,customer_id,vehicle_id) REFERENCES app.vehicle(business_id,customer_id,id),
 CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason))>0))
);
CREATE UNIQUE INDEX invoice_one_active_quote ON app.invoice(business_id,quote_id) WHERE voided_at IS NULL;
CREATE INDEX invoice_customer_idx ON app.invoice(business_id,customer_id,created_at DESC);
SELECT app.apply_tenant_rls('app.invoice');
GRANT SELECT,INSERT ON app.invoice TO app_user;
GRANT UPDATE(voided_at,void_reason,token_hash,expires_at) ON app.invoice TO app_user;
GRANT SELECT ON app.invoice TO worker_user,admin_user;
CREATE TABLE app.invoice_payment (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 invoice_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents<>0 AND abs(amount_cents)<=9007199254740991),
 method text NOT NULL CHECK(method IN ('cash','check','external_card','bank_transfer','reversal')),
 reference text NOT NULL DEFAULT '',reverses_payment_id uuid UNIQUE,reason text,
 UNIQUE(business_id,id),UNIQUE(business_id,invoice_id,id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES app.invoice(business_id,id),
 FOREIGN KEY(business_id,invoice_id,reverses_payment_id) REFERENCES app.invoice_payment(business_id,invoice_id,id),
 CHECK((amount_cents>0 AND method<>'reversal' AND reverses_payment_id IS NULL) OR (amount_cents<0 AND method='reversal' AND reverses_payment_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason))>0))
);
CREATE INDEX invoice_payment_invoice_idx ON app.invoice_payment(business_id,invoice_id,created_at);
SELECT app.apply_tenant_rls('app.invoice_payment');
GRANT SELECT,INSERT ON app.invoice_payment TO app_user;
GRANT SELECT ON app.invoice_payment TO worker_user,admin_user;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.invoice_payment FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.invoice_payment FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
CREATE FUNCTION app.guard_invoice_payment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE i app.invoice; original app.invoice_payment; paid bigint;
BEGIN
 SELECT * INTO i FROM app.invoice WHERE business_id=NEW.business_id AND id=NEW.invoice_id FOR UPDATE;
 IF NOT FOUND OR i.voided_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION: invoice unavailable'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO paid FROM app.invoice_payment WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id;
 IF NEW.amount_cents>0 AND NEW.amount_cents>i.total_cents-paid THEN RAISE EXCEPTION 'INVALID_TRANSITION: amount exceeds balance'; END IF;
 IF NEW.amount_cents<0 THEN
  SELECT * INTO original FROM app.invoice_payment WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id AND id=NEW.reverses_payment_id;
  IF NOT FOUND OR original.amount_cents<=0 OR NEW.amount_cents<>-original.amount_cents THEN RAISE EXCEPTION 'INVALID_TRANSITION: reversal must match original payment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.membership WHERE business_id=NEW.business_id AND user_id=app.current_actor_id() AND role='owner' AND status='active') THEN RAISE EXCEPTION 'INVALID_TRANSITION: only owner can reverse'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_balance BEFORE INSERT ON app.invoice_payment FOR EACH ROW EXECUTE FUNCTION app.guard_invoice_payment();
CREATE FUNCTION app.guard_invoice_void() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF OLD.voided_at IS NOT NULL AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN RAISE EXCEPTION 'INVALID_TRANSITION: void is permanent'; END IF;
 IF NEW.voided_at IS NOT NULL AND coalesce((SELECT sum(amount_cents) FROM app.invoice_payment WHERE business_id=NEW.business_id AND invoice_id=NEW.id),0)<>0 THEN RAISE EXCEPTION 'INVALID_TRANSITION: reverse recorded payments before voiding'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_void BEFORE UPDATE ON app.invoice FOR EACH ROW EXECUTE FUNCTION app.guard_invoice_void();
CREATE POLICY invoice_capability ON app.invoice FOR SELECT TO migration_owner USING(true);
CREATE POLICY invoice_payment_capability ON app.invoice_payment FOR SELECT TO migration_owner USING(true);
CREATE FUNCTION app.read_invoice(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('number',i.number,'snapshot',i.snapshot,'issuedAt',i.created_at,'dueOn',i.due_on,'terms',i.invoice_terms,'voided',i.voided_at IS NOT NULL,'totalCents',i.total_cents,'paidCents',coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0))
 FROM app.invoice i WHERE i.token_hash=p_hash AND i.expires_at>now()
$$;
GRANT EXECUTE ON FUNCTION app.read_invoice(text) TO app_user;
