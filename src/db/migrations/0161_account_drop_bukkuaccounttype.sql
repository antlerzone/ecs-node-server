-- Unify classification in account.type (Bukku-style API tokens), then drop bukkuaccounttype.
-- Idempotent: if bukkuaccounttype column already removed, only runs semantic type fixes on account.type.
-- Run: node scripts/run-migration.js src/db/migrations/0161_account_drop_bukkuaccounttype.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @has_bukku = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND COLUMN_NAME = 'bukkuaccounttype'
);

SET @sql = IF(@has_bukku > 0,
  'UPDATE account SET type = TRIM(bukkuaccounttype) WHERE bukkuaccounttype IS NOT NULL AND CHAR_LENGTH(TRIM(bukkuaccounttype)) > 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE account SET type = CASE LOWER(TRIM(COALESCE(type, '')))
  WHEN 'income' THEN 'REVENUE'
  WHEN 'liability' THEN 'CURRENT_LIABILITY'
  WHEN 'expenses' THEN 'EXPENSE'
  WHEN 'cost_of_sales' THEN 'cost_of_sales'
  ELSE type END
WHERE LOWER(TRIM(COALESCE(type, ''))) IN ('income', 'liability', 'expenses', 'cost_of_sales');

UPDATE account SET type = 'BANK'
WHERE id = '1c7e41b6-9d57-4c03-8122-a76baad3b592' AND LOWER(TRIM(COALESCE(type, ''))) = 'asset';

UPDATE account SET type = 'CURRENT_ASSET'
WHERE id IN (
  'a1b2c3d4-0001-4000-8000-000000000001',
  '26a35506-0631-4d79-9b4f-a8195b69c8ed',
  'd553cdbe-bc6b-46c2-aba8-f71aceedaf10'
) AND LOWER(TRIM(COALESCE(type, ''))) = 'asset';

SET @sql = IF(@has_bukku > 0, 'ALTER TABLE account DROP COLUMN bukkuaccounttype', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
