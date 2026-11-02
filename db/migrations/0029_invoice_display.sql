-- Invoice layout choices: the owner's default template, and an optional
-- per-invoice override. Presentation only; amounts never change.
ALTER TABLE app.business ADD COLUMN invoice_display jsonb;
--> statement-breakpoint
GRANT UPDATE (invoice_display) ON app.business TO app_user;
--> statement-breakpoint
ALTER TABLE app.invoice ADD COLUMN display jsonb;
--> statement-breakpoint
GRANT UPDATE (display) ON app.invoice TO app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.read_invoice(p_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT jsonb_build_object('onlinePaymentEnabled',EXISTS(SELECT 1 FROM app.stripe_connection c WHERE c.business_id=i.business_id AND c.account_id IS NOT NULL AND c.card_payments_status='active'),'number',i.number,'snapshot',i.snapshot,'issuedAt',i.created_at,'dueOn',i.due_on,'terms',i.invoice_terms,'voided',i.voided_at IS NOT NULL,'totalCents',i.total_cents,'paidCents',coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0),
  'displayTemplate',(SELECT b.invoice_display FROM app.business b WHERE b.id=i.business_id),'display',i.display)
 FROM app.invoice i WHERE i.token_hash=p_hash AND i.expires_at>now()
$$;
