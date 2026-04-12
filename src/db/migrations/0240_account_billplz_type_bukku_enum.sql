-- Billplz template (0215) used type `asset`; Bukku POST /accounts expects current_assets (snake_case enum).
UPDATE account
SET type = 'current_assets', updated_at = NOW()
WHERE (id = 'b1b2c3d4-3001-4000-8000-000000000401' OR TRIM(COALESCE(title, '')) = 'Billplz')
  AND LOWER(TRIM(COALESCE(type, ''))) = 'asset';
