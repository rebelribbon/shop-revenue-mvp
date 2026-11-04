-- Deposits: ask for part of the approved total up front on bigger jobs.
ALTER TABLE app.business ADD COLUMN deposits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(deposits) = 'object');
--> statement-breakpoint
GRANT UPDATE (deposits) ON app.business TO app_user;
