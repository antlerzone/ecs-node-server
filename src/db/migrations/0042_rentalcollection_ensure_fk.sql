-- rentalcollection: 若 FK 不存在则添加（client, property, room, tenant, type, tenancy）
-- 与 0001/0032 定义一致；重复执行安全。

SET @tbl = 'rentalcollection';
SET @db = DATABASE();

-- fk_rentalcollection_client
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_client');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fk_rentalcollection_property
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_property');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_property FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fk_rentalcollection_room
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_room');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_room FOREIGN KEY (room_id) REFERENCES roomdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fk_rentalcollection_tenant
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_tenant');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_tenant FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fk_rentalcollection_type
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_type');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_type FOREIGN KEY (type_id) REFERENCES account (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fk_rentalcollection_tenancy (0032 已加列+FK，此处仅补缺)
SET @has = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tbl AND CONSTRAINT_NAME = 'fk_rentalcollection_tenancy');
SET @sql = IF(@has = 0, 'ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_tenancy FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
