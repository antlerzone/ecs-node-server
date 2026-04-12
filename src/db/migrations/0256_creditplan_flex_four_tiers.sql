-- Global flex top-up: exactly four plans — 100/50, 200/110, 500/300, 1000/700 (sellingprice / credit).
-- Custom-input pricing uses the same per-tier unit rate by credit bracket (see flexTopupCustomAmount.js).

DELETE FROM creditplan
WHERE client_id IS NULL
  AND (
    id IN (
      'a1b2c3d4-e5f6-41a8-9b01-000000000064',
      'a1b2c3d4-e5f6-41a8-9b01-0000000000c8',
      'a1b2c3d4-e5f6-41a8-9b01-000000001f4',
      'a1b2c3d4-e5f6-41a8-9b01-000000003e8',
      'a1b2c3d4-e5f6-41a8-9b02-000000000032',
      'a1b2c3d4-e5f6-41a8-9b02-00000000006e',
      'a1b2c3d4-e5f6-41a8-9b02-00000000012c',
      'a1b2c3d4-e5f6-41a8-9b02-000000000320',
      'a1b2c3d4-e5f6-41a8-9b04-000000000032',
      'a1b2c3d4-e5f6-41a8-9b04-00000000006e',
      'a1b2c3d4-e5f6-41a8-9b04-00000000012c',
      'a1b2c3d4-e5f6-41a8-9b04-000000002bc'
    )
    OR (credit IN (50, 110, 300, 700, 800) AND sellingprice IN (100, 200, 500, 1000))
    OR (credit IN (100, 200, 500, 1000, 250) AND sellingprice IN (50, 110, 200, 350, 150, 285, 675, 1200))
  );

INSERT INTO creditplan (id, credit, sellingprice, title, client_id, created_at, updated_at) VALUES
  ('a1b2c3d4-e5f6-41a8-9b04-000000000032',  50,  100, 'Flex top-up · 50 credits', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b04-00000000006e', 110, 200, 'Flex top-up · 110 credits', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b04-00000000012c', 300, 500, 'Flex top-up · 300 credits', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b04-000000002bc', 700, 1000, 'Flex top-up · 700 credits', NULL, NOW(), NOW());
