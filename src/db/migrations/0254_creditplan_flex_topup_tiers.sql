-- Flex top-up catalog (global): 1 credit = 1.5 in operator local currency (MYR/SGD via operatordetail.currency; amounts are numeric only here).
-- Tiers: base; −5% @200; −10% @500; −20% @1000.
-- Idempotent: removes legacy global tiers (50/110/200/350) and any prior rows for these four canonical ids or (credit,sellingprice) pairs.

DELETE FROM creditplan
WHERE client_id IS NULL
  AND (
    id IN (
      'a1b2c3d4-e5f6-41a8-9b01-000000000064',
      'a1b2c3d4-e5f6-41a8-9b01-0000000000c8',
      'a1b2c3d4-e5f6-41a8-9b01-000000001f4',
      'a1b2c3d4-e5f6-41a8-9b01-000000003e8'
    )
    OR (credit IN (100, 250, 500, 1000) AND sellingprice IN (50, 110, 200, 350))
    OR (credit IN (100, 200, 500, 1000) AND sellingprice IN (150, 285, 675, 1200))
  );

-- Post-0087 schema: no wix_id / client_wixid on creditplan.
INSERT INTO creditplan (id, credit, sellingprice, title, client_id, created_at, updated_at) VALUES
  ('a1b2c3d4-e5f6-41a8-9b01-000000000064', 100,  150,  'Flex top-up · 100 credits (base 1.5/credit)', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b01-0000000000c8', 200,  285,  'Flex top-up · 200 credits (−5%)', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b01-000000001f4', 500,  675,  'Flex top-up · 500 credits (−10%)', NULL, NOW(), NOW()),
  ('a1b2c3d4-e5f6-41a8-9b01-000000003e8', 1000, 1200, 'Flex top-up · 1000 credits (−20%)', NULL, NOW(), NOW());
