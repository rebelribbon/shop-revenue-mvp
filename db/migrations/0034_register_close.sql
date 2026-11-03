-- Checkout: closing out the day's cash drawer.
CREATE TABLE app.register_close (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 day date NOT NULL,
 starting_cash_cents bigint NOT NULL CHECK (starting_cash_cents BETWEEN 0 AND 100000000),
 expected_cash_cents bigint NOT NULL,
 counted_cash_cents bigint NOT NULL CHECK (counted_cash_cents BETWEEN 0 AND 100000000),
 taken_cents bigint NOT NULL,
 note text CHECK (note IS NULL OR length(note) <= 1000),
 UNIQUE (business_id, id),
 UNIQUE (business_id, day)
);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.register_close');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.register_close TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.register_close TO worker_user, admin_user;
