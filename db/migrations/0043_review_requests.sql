-- Review requests: ask happy customers for a Google review after they pay.
ALTER TABLE app.business ADD COLUMN review_requests jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(review_requests) = 'object');
--> statement-breakpoint
GRANT UPDATE (review_requests) ON app.business TO app_user;
--> statement-breakpoint
CREATE TABLE app.review_request (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid NOT NULL,
 invoice_id uuid,
 sent_to text NOT NULL CHECK (length(sent_to) <= 320),
 status text NOT NULL CHECK (status IN ('sent', 'failed')),
 automatic boolean NOT NULL,
 provider_message_id text,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
CREATE INDEX review_request_customer_idx ON app.review_request(business_id, customer_id, created_at);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.review_request');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.review_request TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.review_request TO worker_user, admin_user;
--> statement-breakpoint
CREATE FUNCTION app.review_request_businesses() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT id FROM app.business WHERE status = 'active' AND (review_requests->>'on')::boolean IS TRUE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.review_request_businesses() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.review_request_businesses() TO worker_user;
