
-- Shop-recorded disputes pause follow-up without altering invoice balances.
ALTER TABLE app.invoice ADD COLUMN dispute_open text CHECK(dispute_open IS NULL OR length(btrim(dispute_open)) BETWEEN 1 AND 1000);
GRANT UPDATE(dispute_open) ON app.invoice TO app_user;
