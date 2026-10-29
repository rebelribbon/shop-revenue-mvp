CREATE TABLE app.customer (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
  business_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by_user_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  display_name text NOT NULL,
  email text,
  phone_e164 text,
  phone_digits text,
  notes text,
  status text DEFAULT 'active' NOT NULL,
  CONSTRAINT customer_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT customer_business_fk FOREIGN KEY (business_id) REFERENCES app.business(id),
  CONSTRAINT customer_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app."user"(id),
  CONSTRAINT customer_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT customer_name_check CHECK (length(btrim(first_name)) > 0 OR length(btrim(last_name)) > 0),
  CONSTRAINT customer_email_check CHECK (email IS NULL OR email = lower(btrim(email))),
  CONSTRAINT customer_phone_e164_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customer_phone_digits_check CHECK (phone_digits IS NULL OR phone_digits ~ '^[0-9]{7,15}$')
);
--> statement-breakpoint
CREATE INDEX customer_business_display_name_idx ON app.customer (business_id, lower(display_name));
--> statement-breakpoint
CREATE INDEX customer_business_phone_digits_idx ON app.customer (business_id, phone_digits) WHERE phone_digits IS NOT NULL;
--> statement-breakpoint
CREATE INDEX customer_business_email_idx ON app.customer (business_id, email) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE app.vehicle (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
  business_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by_user_id uuid,
  customer_id uuid NOT NULL,
  year integer,
  make text,
  model text,
  trim text,
  vin text,
  vin_last6 text,
  plate text,
  plate_normalized text,
  mileage integer,
  notes text,
  status text DEFAULT 'active' NOT NULL,
  CONSTRAINT vehicle_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT vehicle_business_fk FOREIGN KEY (business_id) REFERENCES app.business(id),
  CONSTRAINT vehicle_customer_tenant_fk FOREIGN KEY (business_id, customer_id) REFERENCES app.customer(business_id, id),
  CONSTRAINT vehicle_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES app."user"(id),
  CONSTRAINT vehicle_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT vehicle_year_check CHECK (year IS NULL OR year BETWEEN 1886 AND 2200),
  CONSTRAINT vehicle_vin_check CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  CONSTRAINT vehicle_vin_last6_check CHECK (vin_last6 IS NULL OR vin_last6 ~ '^[A-HJ-NPR-Z0-9]{6}$'),
  CONSTRAINT vehicle_plate_normalized_check CHECK (plate_normalized IS NULL OR plate_normalized ~ '^[A-Z0-9]+$'),
  CONSTRAINT vehicle_mileage_check CHECK (mileage IS NULL OR mileage BETWEEN 0 AND 3000000)
);
--> statement-breakpoint
CREATE INDEX vehicle_business_customer_idx ON app.vehicle (business_id, customer_id);
--> statement-breakpoint
CREATE INDEX vehicle_business_plate_idx ON app.vehicle (business_id, plate_normalized) WHERE plate_normalized IS NOT NULL;
--> statement-breakpoint
CREATE INDEX vehicle_business_vin_last6_idx ON app.vehicle (business_id, vin_last6) WHERE vin_last6 IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX vehicle_business_vin_unique_idx ON app.vehicle (business_id, vin) WHERE vin IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.customer FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.vehicle FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.customer');
--> statement-breakpoint
SELECT app.apply_tenant_rls('app.vehicle');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.customer, app.vehicle TO app_user;
--> statement-breakpoint
GRANT UPDATE (first_name, last_name, display_name, email, phone_e164, phone_digits, notes, status) ON app.customer TO app_user;
--> statement-breakpoint
GRANT UPDATE (customer_id, year, make, model, trim, vin, vin_last6, plate, plate_normalized, mileage, notes, status) ON app.vehicle TO app_user;
--> statement-breakpoint
GRANT SELECT ON app.customer, app.vehicle TO worker_user, admin_user;
