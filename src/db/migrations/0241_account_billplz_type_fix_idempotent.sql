-- 0215 runs after 0163 and reintroduced Billplz with type `asset`. Force Bukku enum in DB (idempotent).
UPDATE account
SET type = 'current_assets', updated_at = NOW()
WHERE LOWER(TRIM(COALESCE(title, ''))) = 'billplz'
  AND LOWER(TRIM(COALESCE(type, ''))) IN ('asset', 'assets');
