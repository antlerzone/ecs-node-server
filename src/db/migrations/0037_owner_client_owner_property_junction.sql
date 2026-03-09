-- One owner can be authorised for multiple clients and multiple properties.
-- Use junction tables owner_client and owner_property (multiple rows = multiple FKs per owner).
-- ownerdetail.client_id / property_id stay as legacy columns (no FK); Node reads from junction.

-- 1) Remove single-value FK from ownerdetail if they exist (skip if you never added them)
-- ALTER TABLE ownerdetail DROP FOREIGN KEY fk_ownerdetail_client;
-- ALTER TABLE ownerdetail DROP FOREIGN KEY fk_ownerdetail_property;

-- 2) Junction: owner -> many clients (each row = one FK)
CREATE TABLE IF NOT EXISTS owner_client (
  id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_owner_client (owner_id, client_id),
  KEY idx_owner_client_owner_id (owner_id),
  KEY idx_owner_client_client_id (client_id),
  CONSTRAINT fk_owner_client_owner FOREIGN KEY (owner_id) REFERENCES ownerdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_owner_client_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Junction: owner -> many properties (each row = one FK)
CREATE TABLE IF NOT EXISTS owner_property (
  id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  property_id varchar(36) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_owner_property (owner_id, property_id),
  KEY idx_owner_property_owner_id (owner_id),
  KEY idx_owner_property_property_id (property_id),
  CONSTRAINT fk_owner_property_owner FOREIGN KEY (owner_id) REFERENCES ownerdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_owner_property_property FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Backfill owner_client: client_wixid (strip [], split by comma) -> clientdetail.wix_id -> id
INSERT IGNORE INTO owner_client (id, owner_id, client_id)
SELECT UUID(), o.id, c.id
FROM ownerdetail o
CROSS JOIN (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) n
INNER JOIN clientdetail c ON TRIM(COALESCE(c.wix_id, '')) = TRIM(
  SUBSTRING_INDEX(SUBSTRING_INDEX(
    TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.client_wixid, '')), '[', ''), ']', '')),
    ',', n.n), ',', -1)
)
WHERE o.client_wixid IS NOT NULL AND TRIM(o.client_wixid) != ''
  AND n.n <= 1 + (LENGTH(TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.client_wixid,'')), '[', ''), ']', ''))) - LENGTH(REPLACE(TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.client_wixid,'')), '[', ''), ']', '')), ',', '')));

-- 5) Backfill owner_property: property_wixid (strip [], split by comma) -> propertydetail.wix_id -> id
INSERT IGNORE INTO owner_property (id, owner_id, property_id)
SELECT UUID(), o.id, p.id
FROM ownerdetail o
CROSS JOIN (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) n
INNER JOIN propertydetail p ON TRIM(COALESCE(p.wix_id, '')) = TRIM(
  SUBSTRING_INDEX(SUBSTRING_INDEX(
    TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.property_wixid, '')), '[', ''), ']', '')),
    ',', n.n), ',', -1)
)
WHERE o.property_wixid IS NOT NULL AND TRIM(o.property_wixid) != ''
  AND n.n <= 1 + (LENGTH(TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.property_wixid,'')), '[', ''), ']', ''))) - LENGTH(REPLACE(TRIM(REPLACE(REPLACE(TRIM(COALESCE(o.property_wixid,'')), '[', ''), ']', '')), ',', '')));
