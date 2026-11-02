-- The shop's own monthly Shop Revenue subscription (platform billing, not the
-- shop's Connect account). Stripe holds the card and the price; this row is a
-- synced copy used to decide whether the shop may make changes.
CREATE TABLE app.shop_subscription (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL UNIQUE REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 stripe_customer_id text UNIQUE, stripe_subscription_id text UNIQUE,
 status text NOT NULL DEFAULT 'none' CHECK (status IN ('none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
 trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
 past_due_since timestamptz, trial_used_at timestamptz,
 livemode boolean NOT NULL DEFAULT false,
 comped boolean NOT NULL DEFAULT false, comped_reason text,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.shop_subscription');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.shop_subscription TO app_user, worker_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.shop_subscription TO admin_user;
--> statement-breakpoint
GRANT UPDATE (comped, comped_reason, updated_at) ON app.shop_subscription TO admin_user;
--> statement-breakpoint
-- Owners may create the row and record their Stripe customer id. Only the
-- payment processor (system actor) may record subscription state, and only
-- internal staff may comp a shop.
CREATE FUNCTION app.guard_shop_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF app.current_actor_type()='system' THEN
  IF TG_OP='UPDATE' AND (NEW.comped IS DISTINCT FROM OLD.comped OR NEW.comped_reason IS DISTINCT FROM OLD.comped_reason) THEN
   RAISE EXCEPTION 'INVALID_TRANSITION: only internal staff can comp a shop';
  END IF;
  RETURN NEW;
 END IF;
 IF app.current_actor_type()='internal' THEN
  IF TG_OP='INSERT' AND (NEW.status<>'none' OR NEW.stripe_customer_id IS NOT NULL OR NEW.stripe_subscription_id IS NOT NULL) THEN
   RAISE EXCEPTION 'INVALID_TRANSITION: subscription state comes from the payment processor';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM app.membership WHERE business_id=NEW.business_id AND user_id=app.current_actor_id() AND role='owner' AND status='active') THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: owner or payment processor required';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'none' OR NEW.stripe_subscription_id IS NOT NULL OR NEW.comped OR NEW.trial_used_at IS NOT NULL THEN
   RAISE EXCEPTION 'INVALID_TRANSITION: subscription state comes from the payment processor';
  END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
  OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
  OR NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end OR NEW.past_due_since IS DISTINCT FROM OLD.past_due_since
  OR NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at OR NEW.livemode IS DISTINCT FROM OLD.livemode
  OR NEW.comped IS DISTINCT FROM OLD.comped OR NEW.comped_reason IS DISTINCT FROM OLD.comped_reason
  OR (OLD.stripe_customer_id IS NOT NULL AND NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id) THEN
  RAISE EXCEPTION 'INVALID_TRANSITION: subscription state comes from the payment processor';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_actor BEFORE INSERT OR UPDATE ON app.shop_subscription FOR EACH ROW EXECUTE FUNCTION app.guard_shop_subscription();
