-- Cleanlemons B2B invoices: store Bukku / UI issue and due dates (not only created_at).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has_issue := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_invoice' AND COLUMN_NAME = 'issue_date'
);
SET @sql_issue := IF(
  @has_issue = 0,
  'ALTER TABLE `cln_client_invoice` ADD COLUMN `issue_date` DATE NULL COMMENT ''Invoice issue date (e.g. Bukku date)'' AFTER `amount`',
  'SELECT ''skip: issue_date exists'' AS msg'
);
PREPARE stmt_issue FROM @sql_issue;
EXECUTE stmt_issue;
DEALLOCATE PREPARE stmt_issue;

SET @has_due := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_invoice' AND COLUMN_NAME = 'due_date'
);
SET @sql_due := IF(
  @has_due = 0,
  'ALTER TABLE `cln_client_invoice` ADD COLUMN `due_date` DATE NULL COMMENT ''Invoice due date (e.g. Bukku term)'' AFTER `issue_date`',
  'SELECT ''skip: due_date exists'' AS msg'
);
PREPARE stmt_due FROM @sql_due;
EXECUTE stmt_due;
DEALLOCATE PREPARE stmt_due;

-- Backfill from created_at where still null
UPDATE `cln_client_invoice` SET `issue_date` = DATE(`created_at`) WHERE `issue_date` IS NULL;
