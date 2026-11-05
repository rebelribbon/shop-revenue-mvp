-- Supplements: extra work the customer approves after a job is invoiced is
-- billed on an add-on invoice that points at the job's main invoice. Each
-- job still has exactly one live main invoice.
ALTER TABLE app.invoice ADD COLUMN supplement_of uuid;
--> statement-breakpoint
ALTER TABLE app.invoice ADD CONSTRAINT invoice_supplement_of_fk FOREIGN KEY (business_id, supplement_of) REFERENCES app.invoice(business_id, id);
--> statement-breakpoint
DROP INDEX app.invoice_one_active_quote;
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_one_active_quote ON app.invoice(business_id, quote_id) WHERE voided_at IS NULL AND supplement_of IS NULL;
--> statement-breakpoint
-- One live add-on invoice per approved estimate version.
CREATE UNIQUE INDEX invoice_one_active_supplement ON app.invoice(business_id, version_id) WHERE voided_at IS NULL AND supplement_of IS NOT NULL;
