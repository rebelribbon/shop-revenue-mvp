-- Tasks: a reminder to confirm upcoming visits.
ALTER TABLE app.recovery_item DROP CONSTRAINT recovery_item_category_check;
--> statement-breakpoint
ALTER TABLE app.recovery_item ADD CONSTRAINT recovery_item_category_check CHECK (category IN ('declined','open_estimate','unpaid_invoice','lapsed','service_due','new_lead','job_update','visit_confirm'));
