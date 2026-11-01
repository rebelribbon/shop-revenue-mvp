-- Customer contact permissions and owner-confirmed tax rate.
-- Texting and email can each be stopped per customer (e.g. after a STOP reply);
-- null means allowed. The tax rate records who confirmed it and when, so the
-- business owner's choice of rate is on the record.
ALTER TABLE app.customer ADD COLUMN text_opted_out_at timestamptz;
--> statement-breakpoint
ALTER TABLE app.customer ADD COLUMN email_opted_out_at timestamptz;
--> statement-breakpoint
GRANT UPDATE (text_opted_out_at, email_opted_out_at) ON app.customer TO app_user;
--> statement-breakpoint
ALTER TABLE app.business ADD COLUMN tax_rate_confirmed_at timestamptz;
--> statement-breakpoint
ALTER TABLE app.business ADD COLUMN tax_rate_confirmed_by uuid;
--> statement-breakpoint
GRANT UPDATE (tax_rate_confirmed_at, tax_rate_confirmed_by) ON app.business TO app_user;
