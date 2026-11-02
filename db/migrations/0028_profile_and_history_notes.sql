-- Two kinds of notes: profile notes stay pinned to the customer (who they are,
-- how to treat them); history notes are a dated log of what happened. A note
-- may belong to one job. Heads-up profile notes show wherever the customer does.
ALTER TABLE app.note ADD COLUMN kind text NOT NULL DEFAULT 'log' CHECK (kind IN ('profile','log'));
--> statement-breakpoint
ALTER TABLE app.note ADD COLUMN heads_up boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE app.note ADD COLUMN job_id uuid;
--> statement-breakpoint
ALTER TABLE app.note ADD CONSTRAINT note_heads_up_profile CHECK (NOT heads_up OR kind = 'profile');
--> statement-breakpoint
GRANT UPDATE (heads_up) ON app.note TO app_user;
--> statement-breakpoint
CREATE INDEX note_job_idx ON app.note(business_id, job_id) WHERE job_id IS NOT NULL;
