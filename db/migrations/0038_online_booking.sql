-- Online booking: a public "Book online" link per shop. A visitor's request
-- becomes a customer (a new lead) and a task to call them back today.
ALTER TABLE app.business ADD COLUMN booking_slug text UNIQUE CHECK (booking_slug IS NULL OR booking_slug ~ '^[a-z0-9]{12,32}$');
--> statement-breakpoint
GRANT UPDATE (booking_slug) ON app.business TO app_user;
--> statement-breakpoint
CREATE POLICY booking_customer ON app.customer FOR INSERT TO migration_owner WITH CHECK (business_id = app.current_business_id());
--> statement-breakpoint
CREATE POLICY booking_task ON app.task FOR INSERT TO migration_owner WITH CHECK (business_id = app.current_business_id());
--> statement-breakpoint
CREATE FUNCTION app.read_booking(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('name',coalesce(nullif(b.dba,''),b.legal_name),'businessType',b.business_type,'phone',b.phone_e164,'city',b.city)
 FROM app.business b WHERE b.booking_slug=p_slug AND b.status='active'
$$;
--> statement-breakpoint
CREATE FUNCTION app.request_booking(p_slug text,p_first text,p_last text,p_phone text,p_email text,p_what text,p_service text,p_when text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.business; c uuid; who text; today date;
BEGIN
 SELECT * INTO b FROM app.business WHERE booking_slug=p_slug AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION: booking unavailable'; END IF;
 IF length(btrim(coalesce(p_first,'')||coalesce(p_last,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_TRANSITION: name required'; END IF;
 IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'INVALID_TRANSITION: phone required'; END IF;
 IF p_email IS NOT NULL AND (length(p_email)>254 OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'INVALID_TRANSITION: email invalid'; END IF;
 IF length(coalesce(p_what,''))>200 OR length(coalesce(p_service,''))>500 OR length(coalesce(p_when,''))>100 THEN RAISE EXCEPTION 'INVALID_TRANSITION: too long'; END IF;
 PERFORM set_config('app.business_id', b.id::text, true);
 who := btrim(btrim(coalesce(p_first,''))||' '||btrim(coalesce(p_last,'')));
 c := app.uuid_v7();
 INSERT INTO app.customer(id,business_id,first_name,last_name,display_name,phone_e164,phone_digits,email,notes)
  VALUES(c,b.id,btrim(coalesce(p_first,'')),btrim(coalesce(p_last,'')),who,p_phone,substr(p_phone,2),lower(btrim(p_email)),
   'Booked online'||coalesce(': '||nullif(btrim(p_what),''),''));
 today := (now() AT TIME ZONE b.timezone)::date;
 INSERT INTO app.task(business_id,customer_id,title,due_on)
  VALUES(b.id,c,left('Online booking: call '||who||' about '||coalesce(nullif(btrim(p_service),''),'a visit')||coalesce(' ('||nullif(btrim(p_when),'')||')',''),200),today);
 INSERT INTO app.activity(business_id,kind,subject_type,subject_id,actor_type,summary,data)
  VALUES(b.id,'booking.requested','customer',c,'customer','Requested a visit online',
   jsonb_build_object('what',p_what,'service',p_service,'when',p_when));
 RETURN c;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.read_booking(text), app.request_booking(text,text,text,text,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.read_booking(text), app.request_booking(text,text,text,text,text,text,text,text) TO app_user, worker_user;
