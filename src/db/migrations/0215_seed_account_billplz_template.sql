-- Seed canonical Billplz clearing account template for payout journals.

SELECT 'b1b2c3d4-3001-4000-8000-000000000401', 0, 0, 'Billplz', NULL, NOW(), NOW(), 'current_assets', NULL
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM account
  WHERE id = 'b1b2c3d4-3001-4000-8000-000000000401'
     OR TRIM(COALESCE(title, '')) IN ('Billplz', 'Billplz Current Assets')
  LIMIT 1
);
