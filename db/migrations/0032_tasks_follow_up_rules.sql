-- Tasks: the shop's follow-up rules (which reminders, and when), two new
-- reminder kinds, and tasks the shop writes itself.
ALTER TABLE app.business ADD COLUMN follow_up_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(follow_up_rules) = 'object');
--> statement-breakpoint
GRANT UPDATE (follow_up_rules) ON app.business TO app_user;
--> statement-breakpoint
ALTER TABLE app.recovery_item DROP CONSTRAINT recovery_item_category_check;
--> statement-breakpoint
ALTER TABLE app.recovery_item ADD CONSTRAINT recovery_item_category_check CHECK (category IN ('declined','open_estimate','unpaid_invoice','lapsed','service_due','new_lead','job_update'));
--> statement-breakpoint
CREATE TABLE app.task (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id uuid REFERENCES app."user"(id),
 customer_id uuid, job_id uuid,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 due_on date NOT NULL,
 done_at timestamptz,
 UNIQUE (business_id, id),
 FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id)
);
--> statement-breakpoint
CREATE INDEX task_open_idx ON app.task(business_id, due_on) WHERE done_at IS NULL;
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.task');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.task TO app_user;
--> statement-breakpoint
GRANT UPDATE (title, due_on, done_at, updated_at) ON app.task TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.task TO worker_user, admin_user;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.task FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
