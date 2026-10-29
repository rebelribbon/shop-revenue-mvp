-- Drizzle lists every column in INSERT (DEFAULT for unset ones), and Postgres
-- checks column INSERT privileges for all listed columns, so column-limited
-- INSERT grants cannot work. Grant INSERT at table level; the rows themselves
-- stay constrained by RLS WITH CHECK, CHECK constraints and guard triggers
-- (user: self only; support_session: times and end state set by trigger;
-- legal_policy: insert only as draft, hash computed by trigger).
-- Column-limited UPDATE grants are unaffected and remain.
GRANT INSERT ON app."user" TO app_user;
--> statement-breakpoint
GRANT INSERT ON app.support_session TO admin_user;
--> statement-breakpoint
GRANT INSERT ON app.legal_policy TO admin_user;
