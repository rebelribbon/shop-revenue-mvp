CREATE POLICY m2_backfill ON app.vehicle FOR SELECT TO migration_owner USING (true);
-- Preserve existing vehicle identifiers and customer links while introducing assets.
CREATE TABLE app.asset (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id uuid REFERENCES app."user"(id), customer_id uuid NOT NULL,
 type text NOT NULL DEFAULT 'vehicle' CHECK (type = 'vehicle'), display_name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
 UNIQUE (business_id,id),
 FOREIGN KEY (business_id,customer_id) REFERENCES app.customer(business_id,id)
);
INSERT INTO app.asset (id,business_id,created_at,updated_at,created_by_user_id,customer_id,display_name,status)
 SELECT id,business_id,created_at,updated_at,created_by_user_id,customer_id,
 COALESCE(NULLIF(concat_ws(' ',year,make,model),''),'Vehicle'), CASE WHEN status='archived' THEN 'inactive' ELSE 'active' END FROM app.vehicle;
ALTER TABLE app.vehicle ADD CONSTRAINT vehicle_asset_tenant_fk FOREIGN KEY (business_id,id) REFERENCES app.asset(business_id,id);
SELECT app.apply_tenant_rls('app.asset');
GRANT SELECT,INSERT ON app.asset TO app_user;
GRANT UPDATE (customer_id,display_name,status) ON app.asset TO app_user;
GRANT SELECT ON app.asset TO worker_user,admin_user;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.asset FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE INDEX asset_customer_idx ON app.asset(business_id,customer_id);
CREATE FUNCTION app.sync_vehicle_asset() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO app.asset(id,business_id,created_by_user_id,customer_id,display_name,status)
   VALUES(NEW.id,NEW.business_id,NEW.created_by_user_id,NEW.customer_id,
   COALESCE(NULLIF(concat_ws(' ',NEW.year,NEW.make,NEW.model),''),'Vehicle'),
   CASE WHEN NEW.status='archived' THEN 'inactive' ELSE 'active' END);
 ELSE
  UPDATE app.asset SET customer_id=NEW.customer_id,
   display_name=COALESCE(NULLIF(concat_ws(' ',NEW.year,NEW.make,NEW.model),''),'Vehicle'),
   status=CASE WHEN NEW.status='archived' THEN 'inactive' ELSE 'active' END
   WHERE business_id=NEW.business_id AND id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_asset BEFORE INSERT OR UPDATE ON app.vehicle FOR EACH ROW EXECUTE FUNCTION app.sync_vehicle_asset();

CREATE TABLE app.asset_reading (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id uuid REFERENCES app."user"(id), asset_id uuid NOT NULL,
 reading_type text NOT NULL DEFAULT 'odometer' CHECK (reading_type='odometer'),
 value integer NOT NULL CHECK (value BETWEEN 0 AND 3000000), unit text NOT NULL DEFAULT 'mi' CHECK (unit='mi'),
 read_on timestamptz NOT NULL DEFAULT now(), source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','migration')),
 UNIQUE(business_id,id), FOREIGN KEY(business_id,asset_id) REFERENCES app.asset(business_id,id)
);
INSERT INTO app.asset_reading(business_id,asset_id,value,read_on,source,created_by_user_id)
 SELECT business_id,id,mileage,updated_at,'migration',created_by_user_id FROM app.vehicle WHERE mileage IS NOT NULL;
SELECT app.apply_tenant_rls('app.asset_reading');
GRANT SELECT,INSERT ON app.asset_reading TO app_user;
GRANT SELECT ON app.asset_reading TO worker_user,admin_user;
CREATE INDEX asset_reading_history_idx ON app.asset_reading(business_id,asset_id,read_on DESC,id DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.asset_reading FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON app.asset_reading FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
CREATE FUNCTION app.capture_vehicle_mileage() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NEW.mileage IS NOT NULL AND (TG_OP='INSERT' OR NEW.mileage IS DISTINCT FROM OLD.mileage) THEN
  INSERT INTO app.asset_reading(business_id,asset_id,value,created_by_user_id)
   VALUES(NEW.business_id,NEW.id,NEW.mileage,CASE WHEN app.current_actor_type()='user' THEN app.current_actor_id() ELSE NULL END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_mileage AFTER INSERT OR UPDATE ON app.vehicle FOR EACH ROW EXECUTE FUNCTION app.capture_vehicle_mileage();

CREATE TABLE app.note (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), business_id uuid NOT NULL REFERENCES app.business(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id uuid REFERENCES app."user"(id), customer_id uuid NOT NULL, vehicle_id uuid,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 5000), deleted_at timestamptz,
 UNIQUE(business_id,id), FOREIGN KEY(business_id,customer_id) REFERENCES app.customer(business_id,id),
 FOREIGN KEY(business_id,customer_id,vehicle_id) REFERENCES app.vehicle(business_id,customer_id,id)
);
SELECT app.apply_tenant_rls('app.note');
GRANT SELECT,INSERT ON app.note TO app_user;
GRANT UPDATE(body,deleted_at) ON app.note TO app_user;
GRANT SELECT ON app.note TO worker_user,admin_user;
CREATE INDEX note_customer_idx ON app.note(business_id,customer_id,created_at DESC);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.note FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.vin_decode_cache (
 vin text PRIMARY KEY CHECK(vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), payload jsonb NOT NULL,
 decoded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.vin_decode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vin_decode_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY public_vehicle_data ON app.vin_decode_cache TO app_user USING(true) WITH CHECK(true);
SELECT app.apply_support_read_only('app.vin_decode_cache');
GRANT SELECT,INSERT,UPDATE ON app.vin_decode_cache TO app_user;
-- Appointments must use the same support-mode protections as other tenant records.
SELECT app.apply_support_read_only('app.appointment');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.appointment FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DROP POLICY m2_backfill ON app.vehicle;
