-- Parts catalog with stock counts. Stock is a running count plus an
-- append-only log of every change (received, used on an invoice, returned
-- when an invoice is voided, counted).
CREATE TABLE app.part_item (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
 part_number text CHECK (part_number IS NULL OR length(part_number) <= 100),
 unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
 unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
 on_hand_hundredths bigint NOT NULL DEFAULT 0,
 reorder_at_hundredths bigint CHECK (reorder_at_hundredths IS NULL OR reorder_at_hundredths >= 0),
 archived_at timestamptz,
 UNIQUE (business_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX part_item_name_live ON app.part_item(business_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.part_item');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.part_item TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, part_number, unit_cost_cents, unit_price_cents, on_hand_hundredths, reorder_at_hundredths, archived_at, updated_at) ON app.part_item TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.part_item TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.part_item FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TABLE app.stock_move (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 part_item_id uuid NOT NULL,
 change_hundredths bigint NOT NULL CHECK (change_hundredths <> 0),
 reason text NOT NULL CHECK (reason IN ('received', 'used', 'returned', 'counted')),
 invoice_id uuid,
 note text CHECK (note IS NULL OR length(note) <= 500),
 UNIQUE (business_id, id),
 FOREIGN KEY (business_id, part_item_id) REFERENCES app.part_item(business_id, id)
);
--> statement-breakpoint
CREATE INDEX stock_move_part_idx ON app.stock_move(business_id, part_item_id, created_at);
--> statement-breakpoint
CREATE INDEX stock_move_invoice_idx ON app.stock_move(business_id, invoice_id) WHERE invoice_id IS NOT NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.stock_move');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.stock_move TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.stock_move TO worker_user, admin_user;
