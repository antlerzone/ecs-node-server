-- TTLock OAuth tokens for Cleanlemons-scoped subjects.
-- `ttlocktoken.client_id` FK targets Coliving `operatordetail` only; storing cln_clientdetail / cln_operatordetail
-- UUIDs there causes ER_NO_REFERENCED_ROW_2. This table holds tokens for those IDs (exactly one scope per row).

SET NAMES utf8mb4;
SET @db = DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
);
SET @sql_create := IF(
  @has_table = 0,
  'CREATE TABLE `cln_ttlocktoken` (
    `id` CHAR(36) NOT NULL,
    `clientdetail_id` CHAR(36) NULL COMMENT ''FK cln_clientdetail — B2B client portal / Coliving link'',
    `operator_id` CHAR(36) NULL COMMENT ''FK cln_operatordetail — Cleanlemons operator company'',
    `accesstoken` TEXT NULL,
    `refreshtoken` TEXT NULL,
    `expiresin` INT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_cln_ttlocktoken_clientdetail` (`clientdetail_id`),
    UNIQUE KEY `uq_cln_ttlocktoken_operator` (`operator_id`),
    CONSTRAINT `fk_cln_ttlocktoken_clientdetail`
      FOREIGN KEY (`clientdetail_id`) REFERENCES `cln_clientdetail` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_ttlocktoken_cln_operator`
      FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt_create FROM @sql_create;
EXECUTE stmt_create;
DEALLOCATE PREPARE stmt_create;
