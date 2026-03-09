-- Store integration / profile / pricingplandetail / credit JSON on clientdetail so that
-- syncSubtablesFromClientdetail(conn, clientId) can read and sync to client_* subtables.
-- Run once. To run idempotent, execute each block only if the column is missing (e.g. check information_schema).
ALTER TABLE clientdetail ADD COLUMN integration TEXT DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN profile TEXT DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN pricingplandetail TEXT DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN credit TEXT DEFAULT NULL;
