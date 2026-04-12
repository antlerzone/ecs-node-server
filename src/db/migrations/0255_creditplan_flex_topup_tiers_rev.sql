-- Flex top-up (global, client_id IS NULL): revised tiers — user-defined credit/price pairs.
-- Removes 0254 tiers and any rows matching these (credit, sellingprice) for idempotent re-run.
-- Base anchor: 50 credits @ 100 local units; MYR/SGD label from operatordetail.currency only.

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
      'a1b2c3d4-e5f6-41a8-9b02-000000000320'
    )
    OR (credit IN (100, 200, 500, 1000) AND sellingprice IN (150, 285, 675, 1200))
    OR (credit IN (50, 110, 300, 800) AND sellingprice IN (100, 200, 500, 1000))
  );

INSERT INTO creditplan (id, credit, sellingprice, title, client_id, created_at, updated_at) VALUES
  ('a1b2c3d4-e5f6-41a8-9b02-000000000032',  50,  100, 'Flex top-up · 50 credits (base)', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b02-00000000006e', 110, 200, 'Flex top-up · 110 credits', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b02-00000000012c', 300, 500, 'Flex top-up · 300 credits', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b02-000000000320', 800, 1000, 'Flex top-up · 800 credits', NULL, NOW(), NOW());
