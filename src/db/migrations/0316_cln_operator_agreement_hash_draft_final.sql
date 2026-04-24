-- Cleanlemons: agreement PDF integrity (draft / final SHA-256 hex).
SET @db := DATABASE();

SET @has_draft := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_agreement' AND column_name = 'hash_draft'
);
SET @sql_draft := IF(
  @has_draft = 0,
  'ALTER TABLE `cln_operator_agreement` ADD COLUMN `hash_draft` VARCHAR(128) NULL DEFAULT NULL COMMENT ''SHA-256 hex of first materialized filled PDF body'' AFTER `final_agreement_url`',
  'SELECT ''skip: cln_operator_agreement.hash_draft exists'' AS msg'
);
PREPARE stmt_d FROM @sql_draft;
EXECUTE stmt_d;
DEALLOCATE PREPARE stmt_d;

SET @has_final := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_agreement' AND column_name = 'hash_final'
);
SET @sql_final := IF(
  @has_final = 0,
  'ALTER TABLE `cln_operator_agreement` ADD COLUMN `hash_final` VARCHAR(128) NULL DEFAULT NULL COMMENT ''SHA-256 hex of merged main+audit PDF'' AFTER `hash_draft`',
  'SELECT ''skip: cln_operator_agreement.hash_final exists'' AS msg'
);
PREPARE stmt_f FROM @sql_final;
EXECUTE stmt_f;
DEALLOCATE PREPARE stmt_f;
