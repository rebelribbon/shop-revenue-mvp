-- Runtime credentials are environment secrets; only provider identifiers live here.
CREATE TABLE app.stripe_connection (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL UNIQUE REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 account_id text UNIQUE,card_payments_status text NOT NULL DEFAULT 'not_connected',livemode boolean NOT NULL DEFAULT false,
 UNIQUE(business_id,id)
);
SELECT app.apply_tenant_rls('app.stripe_connection');
GRANT SELECT,INSERT,UPDATE ON app.stripe_connection TO app_user,worker_user;
GRANT SELECT ON app.stripe_connection TO admin_user;
CREATE TABLE app.invoice_checkout (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 invoice_id uuid NOT NULL,account_id text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0 AND amount_cents<=99999999),
 currency text NOT NULL DEFAULT 'usd' CHECK(currency='usd'),status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','open','processing','paid','expired','failed')),
 session_id text UNIQUE,payment_intent_id text,expires_at timestamptz NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,invoice_id,id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES app.invoice(business_id,id)
);
CREATE UNIQUE INDEX invoice_checkout_active ON app.invoice_checkout(business_id,invoice_id) WHERE status IN ('creating','open','processing');
CREATE INDEX invoice_checkout_invoice_idx ON app.invoice_checkout(business_id,invoice_id);
SELECT app.apply_tenant_rls('app.invoice_checkout');
GRANT SELECT,INSERT,UPDATE ON app.invoice_checkout TO app_user,worker_user;
GRANT SELECT ON app.invoice_checkout TO admin_user;
ALTER TABLE app.invoice_payment ADD COLUMN stripe_payment_intent_id text;
ALTER TABLE app.invoice_payment ADD COLUMN stripe_refund_id text;
ALTER TABLE app.invoice_payment ADD COLUMN stripe_account_id text;
ALTER TABLE app.invoice_payment ADD COLUMN checkout_id uuid;
ALTER TABLE app.invoice_payment ADD CONSTRAINT payment_checkout_fk FOREIGN KEY(business_id,invoice_id,checkout_id) REFERENCES app.invoice_checkout(business_id,invoice_id,id);
ALTER TABLE app.invoice_payment DROP CONSTRAINT invoice_payment_method_check;
ALTER TABLE app.invoice_payment DROP CONSTRAINT invoice_payment_check;
ALTER TABLE app.invoice_payment DROP CONSTRAINT invoice_payment_reverses_payment_id_key;
CREATE UNIQUE INDEX invoice_payment_reversal_once ON app.invoice_payment(reverses_payment_id) WHERE method='reversal';
CREATE UNIQUE INDEX invoice_payment_stripe_once ON app.invoice_payment(stripe_account_id,stripe_payment_intent_id) WHERE method='stripe';
CREATE UNIQUE INDEX invoice_payment_refund_once ON app.invoice_payment(stripe_account_id,stripe_refund_id) WHERE method='stripe_refund';
ALTER TABLE app.invoice_payment ADD CHECK(method IN ('cash','check','external_card','bank_transfer','reversal','stripe','stripe_refund'));
ALTER TABLE app.invoice_payment ADD CHECK(
 (amount_cents>0 AND method NOT IN ('reversal','stripe_refund') AND reverses_payment_id IS NULL) OR
 (amount_cents<0 AND method IN ('reversal','stripe_refund') AND reverses_payment_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason))>0));
ALTER TABLE app.invoice_payment ADD CHECK(
 (method='stripe' AND stripe_payment_intent_id IS NOT NULL AND stripe_account_id IS NOT NULL AND checkout_id IS NOT NULL AND stripe_refund_id IS NULL) OR
 (method='stripe_refund' AND stripe_refund_id IS NOT NULL AND stripe_account_id IS NOT NULL AND stripe_payment_intent_id IS NULL AND checkout_id IS NULL) OR
 (method NOT IN ('stripe','stripe_refund') AND stripe_payment_intent_id IS NULL AND stripe_refund_id IS NULL AND stripe_account_id IS NULL AND checkout_id IS NULL));
GRANT INSERT ON app.invoice_payment TO worker_user;
CREATE TABLE app.invoice_refund (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by_user_id uuid REFERENCES app."user"(id),
 invoice_id uuid NOT NULL,payment_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),reason text NOT NULL CHECK(length(btrim(reason))>0),
 status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','succeeded','failed','canceled')),
 stripe_refund_id text UNIQUE,UNIQUE(business_id,id),
 FOREIGN KEY(business_id,invoice_id,payment_id) REFERENCES app.invoice_payment(business_id,invoice_id,id)
);
CREATE INDEX invoice_refund_payment_idx ON app.invoice_refund(business_id,payment_id);
SELECT app.apply_tenant_rls('app.invoice_refund');
GRANT SELECT,INSERT,UPDATE ON app.invoice_refund TO app_user,worker_user;
GRANT SELECT ON app.invoice_refund TO admin_user;
-- A verified, signed-in owner initiates connection/refunds; only trusted server
-- system operations can record provider outcomes. Support remains blocked by RLS.
CREATE FUNCTION app.guard_stripe_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF app.current_actor_type()='system' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='invoice_checkout' OR NOT EXISTS(SELECT 1 FROM app.membership WHERE business_id=NEW.business_id AND user_id=app.current_actor_id() AND role='owner' AND status='active') THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: owner or payment processor required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_actor BEFORE INSERT OR UPDATE ON app.stripe_connection FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_write();
CREATE TRIGGER guard_actor BEFORE INSERT OR UPDATE ON app.invoice_checkout FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_write();
CREATE TRIGGER guard_actor BEFORE INSERT OR UPDATE ON app.invoice_refund FOR EACH ROW EXECUTE FUNCTION app.guard_stripe_write();
CREATE OR REPLACE FUNCTION app.guard_invoice_payment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE i app.invoice; original app.invoice_payment; paid bigint; c app.invoice_checkout;
BEGIN
 SELECT * INTO i FROM app.invoice WHERE business_id=NEW.business_id AND id=NEW.invoice_id FOR UPDATE;
 IF NOT FOUND OR i.voided_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION: invoice unavailable'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO paid FROM app.invoice_payment WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id;
 IF NEW.amount_cents>0 AND NEW.amount_cents>i.total_cents-paid THEN RAISE EXCEPTION 'INVALID_TRANSITION: amount exceeds balance'; END IF;
 IF NEW.method NOT IN ('stripe','stripe_refund') AND (EXISTS(SELECT 1 FROM app.invoice_checkout WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id AND status IN ('creating','open','processing')) OR EXISTS(SELECT 1 FROM app.invoice_refund WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id AND status IN ('creating','pending'))) THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: reconcile online payment first';
 END IF;
 IF NEW.method='stripe' THEN
  SELECT * INTO c FROM app.invoice_checkout WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id AND id=NEW.checkout_id;
  IF app.current_actor_type()<>'system' OR NOT FOUND OR c.account_id<>NEW.stripe_account_id OR c.amount_cents<>NEW.amount_cents OR c.payment_intent_id IS DISTINCT FROM NEW.stripe_payment_intent_id THEN RAISE EXCEPTION 'INVALID_TRANSITION: unverified provider payment'; END IF;
 ELSIF NEW.amount_cents<0 THEN
  SELECT * INTO original FROM app.invoice_payment WHERE business_id=NEW.business_id AND invoice_id=NEW.invoice_id AND id=NEW.reverses_payment_id;
  IF NOT FOUND OR original.amount_cents<=0 THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid original payment'; END IF;
  IF NEW.method='reversal' THEN
   IF original.method='stripe' OR NEW.amount_cents<>-original.amount_cents OR NOT EXISTS(SELECT 1 FROM app.membership WHERE business_id=NEW.business_id AND user_id=app.current_actor_id() AND role='owner' AND status='active') THEN RAISE EXCEPTION 'INVALID_TRANSITION: owner reversal must match a manual payment'; END IF;
  ELSE
   IF app.current_actor_type()<>'system' OR original.method<>'stripe' OR original.stripe_account_id<>NEW.stripe_account_id OR abs(NEW.amount_cents)>(SELECT original.amount_cents+coalesce(sum(amount_cents),0) FROM app.invoice_payment WHERE business_id=NEW.business_id AND reverses_payment_id=original.id) THEN RAISE EXCEPTION 'INVALID_TRANSITION: invalid refund'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_checkout_void() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NEW.voided_at IS NOT NULL AND (EXISTS(SELECT 1 FROM app.invoice_checkout WHERE business_id=NEW.business_id AND invoice_id=NEW.id AND status IN ('creating','open','processing')) OR EXISTS(SELECT 1 FROM app.invoice_refund WHERE business_id=NEW.business_id AND invoice_id=NEW.id AND status IN ('creating','pending'))) THEN RAISE EXCEPTION 'INVALID_TRANSITION: reconcile online payment first'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_online_void BEFORE UPDATE ON app.invoice FOR EACH ROW EXECUTE FUNCTION app.guard_checkout_void();
CREATE FUNCTION app.invoice_payment_context(p_hash text) RETURNS TABLE(invoice_id uuid,business_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.id,i.business_id FROM app.invoice i WHERE i.token_hash=p_hash AND i.expires_at>now() AND i.voided_at IS NULL AND app.current_actor_type()='customer'
$$;
REVOKE ALL ON FUNCTION app.invoice_payment_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invoice_payment_context(text) TO app_user;
CREATE POLICY connection_route ON app.stripe_connection FOR SELECT TO migration_owner USING(true);
CREATE FUNCTION app.stripe_business(p_account text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.business_id FROM app.stripe_connection c WHERE c.account_id=p_account
$$;
REVOKE ALL ON FUNCTION app.stripe_business(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stripe_business(text) TO worker_user;

CREATE OR REPLACE FUNCTION app.read_invoice(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('onlinePaymentEnabled',EXISTS(SELECT 1 FROM app.stripe_connection c WHERE c.business_id=i.business_id AND c.account_id IS NOT NULL AND c.card_payments_status='active'),'number',i.number,'snapshot',i.snapshot,'issuedAt',i.created_at,'dueOn',i.due_on,'terms',i.invoice_terms,'voided',i.voided_at IS NOT NULL,'totalCents',i.total_cents,'paidCents',coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0))
 FROM app.invoice i WHERE i.token_hash=p_hash AND i.expires_at>now()
$$;
