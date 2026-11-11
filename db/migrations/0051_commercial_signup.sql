-- Checkout reservations keep repeated/concurrent starts on one Stripe session.
ALTER TABLE app.shop_subscription ADD COLUMN checkout_attempt_id text,
  ADD COLUMN checkout_price_id text, ADD COLUMN checkout_expires_at timestamptz;
--> statement-breakpoint
-- Existing resolver policies already permit migration_owner to see user,
-- membership and business. Only the server's admin role may call this lookup.
CREATE FUNCTION app.signup_owner_business(subject uuid)
RETURNS TABLE(business_id uuid, business_status text, membership_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.id,b.status,m.status FROM app."user" u
 JOIN app.membership m ON m.user_id=u.id AND m.role='owner'
 JOIN app.business b ON b.id=m.business_id
 WHERE u.auth_provider_id=subject ORDER BY m.created_at LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.signup_owner_business(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.signup_owner_business(uuid) TO admin_user;

--> statement-breakpoint
CREATE POLICY billing_customer_lookup ON app.shop_subscription FOR SELECT TO migration_owner USING(true);
--> statement-breakpoint
CREATE FUNCTION app.billing_customer_business(customer text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT business_id FROM app.shop_subscription WHERE stripe_customer_id=customer
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.billing_customer_business(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.billing_customer_business(text) TO worker_user;
