-- Fixture for the CI self-test: a migration that adds a tenant table and forgets RLS.
CREATE TABLE app.forgot_rls (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  business_id uuid NOT NULL REFERENCES app.business (id)
);
