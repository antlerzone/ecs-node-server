-- Align roomdetail.active with archived properties: archived listings should not stay "active" on rooms.
UPDATE roomdetail r
INNER JOIN propertydetail p ON p.id = r.property_id
SET r.active = 0, r.updated_at = NOW()
WHERE COALESCE(p.archived, 0) = 1
  AND COALESCE(r.active, 0) = 1;
