-- Each shop controls whether inspection findings and summary video need evidence.
-- Default OFF keeps technician inspections lightweight.
ALTER TABLE app.business
  ADD COLUMN IF NOT EXISTS inspection_media_requirements jsonb NOT NULL
  DEFAULT '{"photos":false,"videos":false}'::jsonb;
--> statement-breakpoint
ALTER TABLE app.business
  ADD CONSTRAINT inspection_media_requirements_valid CHECK (
    jsonb_typeof(inspection_media_requirements) = 'object'
    AND jsonb_typeof(inspection_media_requirements -> 'photos') = 'boolean'
    AND jsonb_typeof(inspection_media_requirements -> 'videos') = 'boolean'
  );
