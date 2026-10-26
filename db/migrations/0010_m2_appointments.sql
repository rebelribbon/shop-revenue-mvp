ALTER TABLE app.vehicle ADD CONSTRAINT vehicle_business_customer_id_id_key UNIQUE (business_id, customer_id, id);

CREATE TABLE app.appointment (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
  business_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by_user_id uuid,
  customer_id uuid NOT NULL,
  vehicle_id uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  reason text,
  notes text,
  status text DEFAULT 'scheduled' NOT NULL,
  CONSTRAINT appointment_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT appointment_status_check CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT appointment_time_check CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT appointment_reason_check CHECK (reason IS NULL OR length(btrim(reason)) > 0),
  CONSTRAINT appointment_business_fk FOREIGN KEY (business_id) REFERENCES app.business(id),
  CONSTRAINT appointment_customer_tenant_fk FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id),
  CONSTRAINT appointment_vehicle_customer_tenant_fk FOREIGN KEY (business_id, customer_id, vehicle_id) REFERENCES app.vehicle(business_id, customer_id, id),
  CONSTRAINT appointment_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app."user"(id)
);

CREATE INDEX appointment_business_starts_idx ON app.appointment (business_id, starts_at);
CREATE INDEX appointment_business_customer_starts_idx ON app.appointment (business_id, customer_id, starts_at DESC);

ALTER TABLE app.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.appointment
  USING (business_id = app.current_business_id())
  WITH CHECK (business_id = app.current_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.appointment TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.appointment TO worker_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.appointment TO admin_user;
