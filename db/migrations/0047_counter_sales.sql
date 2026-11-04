-- Quick sale: a counter sale of parts or items with no job, paid on the
-- spot. It's a receipt, not an invoice: invoices keep their signed
-- estimate trail. Voiding is allowed the same day only.
CREATE TABLE app.counter_sale (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 number integer NOT NULL CHECK (number > 0),
 lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 50),
 subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
 tax_bps integer NOT NULL CHECK (tax_bps BETWEEN 0 AND 2500),
 tax_cents bigint NOT NULL CHECK (tax_cents >= 0),
 total_cents bigint NOT NULL CHECK (total_cents > 0 AND total_cents = subtotal_cents + tax_cents),
 method text NOT NULL CHECK (method IN ('cash', 'external_card', 'check')),
 reference text CHECK (reference IS NULL OR length(reference) <= 100),
 received_cents bigint CHECK (received_cents IS NULL OR received_cents >= total_cents),
 voided_at timestamptz,
 voided_by_user_id uuid REFERENCES app."user"(id),
 void_reason text CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 500),
 UNIQUE (business_id, id),
 UNIQUE (business_id, number),
 CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
--> statement-breakpoint
CREATE INDEX counter_sale_day_idx ON app.counter_sale(business_id, created_at);
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.counter_sale');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.counter_sale TO app_user;
--> statement-breakpoint
GRANT UPDATE (voided_at, voided_by_user_id, void_reason, updated_at) ON app.counter_sale TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.counter_sale TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.counter_sale FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
ALTER TABLE app.stock_move ADD COLUMN counter_sale_id uuid;
