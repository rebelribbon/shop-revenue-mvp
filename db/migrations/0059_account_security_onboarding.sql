-- Account-wide security and setup state. Only the trusted server role can
-- access these tables; neither the browser nor tenant roles receive privileges.
CREATE TABLE app.account_security (
 auth_subject uuid PRIMARY KEY,
 method text NOT NULL CHECK (method IN ('email','authenticator')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.email_second_step (
 auth_subject uuid NOT NULL,
 session_id uuid NOT NULL,
 code_hash text NOT NULL CHECK (length(code_hash) = 64),
 change_method boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 PRIMARY KEY (auth_subject, session_id)
);
CREATE INDEX email_second_step_expiry_idx ON app.email_second_step(expires_at);
CREATE TABLE app.onboarding_progress (
 auth_subject uuid PRIMARY KEY,
 step integer NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 6),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 draft jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft) = 'object'),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.account_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.account_security FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.account_security FROM PUBLIC, app_user, worker_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.account_security TO admin_user;
CREATE POLICY account_security_server ON app.account_security FOR ALL TO admin_user USING (true) WITH CHECK (true);
ALTER TABLE app.email_second_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_second_step FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.email_second_step FROM PUBLIC, app_user, worker_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.email_second_step TO admin_user;
CREATE POLICY email_second_step_server ON app.email_second_step FOR ALL TO admin_user USING (true) WITH CHECK (true);
ALTER TABLE app.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.onboarding_progress FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.onboarding_progress FROM PUBLIC, app_user, worker_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.onboarding_progress TO admin_user;
CREATE POLICY onboarding_progress_server ON app.onboarding_progress FOR ALL TO admin_user USING (true) WITH CHECK (true);
