-- Cleanlemons: FK `cln_operator_subscription.operator_id` → `cln_operatordetail(id)`.
-- Same for `cln_operator_subscription_addon.operator_id`.
-- Requires `cln_operatordetail` (0198). Skips when absent (Coliving-only / pre-rename DB).
-- Removes subscription add-on rows, then subscription rows, whose operator_id is not a valid master id.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has_od := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operatordetail'
);

SET @has_sub := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operator_subscription'
);

SET @has_addon := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operator_subscription_addon'
);

-- Drop FKs if re-running / upgrading
SET @fk_addon_exist := IF(
  @has_addon > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_subscription_addon'
     AND CONSTRAINT_NAME = 'fk_cln_operator_subscription_addon_operatordetail'),
  1
);
SET @sql := IF(
  @has_od > 0 AND @has_addon > 0 AND @fk_addon_exist > 0,
  'ALTER TABLE `cln_operator_subscription_addon` DROP FOREIGN KEY `fk_cln_operator_subscription_addon_operatordetail`',
  'SELECT 1'
);
PREPARE s0 FROM @sql;
EXECUTE s0;
DEALLOCATE PREPARE s0;

SET @fk_sub_exist := IF(
  @has_sub > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_subscription'
     AND CONSTRAINT_NAME = 'fk_cln_operator_subscription_operatordetail'),
  1
);
SET @sql := IF(
  @has_od > 0 AND @has_sub > 0 AND @fk_sub_exist > 0,
  'ALTER TABLE `cln_operator_subscription` DROP FOREIGN KEY `fk_cln_operator_subscription_operatordetail`',
  'SELECT 1'
);
PREPARE s0b FROM @sql;
EXECUTE s0b;
DEALLOCATE PREPARE s0b;

-- Orphan cleanup (addons first)
SET @sql := IF(
  @has_od > 0 AND @has_addon > 0,
  'DELETE a FROM `cln_operator_subscription_addon` a WHERE NOT EXISTS (SELECT 1 FROM `cln_operatordetail` o WHERE o.id = a.operator_id)',
  'SELECT 1'
);
PREPARE s1 FROM @sql;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @sql := IF(
  @has_od > 0 AND @has_sub > 0,
  'DELETE s FROM `cln_operator_subscription` s WHERE NOT EXISTS (SELECT 1 FROM `cln_operatordetail` o WHERE o.id = s.operator_id)',
  'SELECT 1'
);
PREPARE s2 FROM @sql;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- Align column types with `cln_operatordetail.id` (CHAR(36) utf8mb4_unicode_ci)
SET @sql := IF(
  @has_od > 0 AND @has_sub > 0,
  'ALTER TABLE `cln_operator_subscription` MODIFY COLUMN `operator_id` CHAR(36) NOT NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE s3 FROM @sql;
EXECUTE s3;
DEALLOCATE PREPARE s3;

SET @sql := IF(
  @has_od > 0 AND @has_addon > 0,
  'ALTER TABLE `cln_operator_subscription_addon` MODIFY COLUMN `operator_id` CHAR(36) NOT NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE s4 FROM @sql;
EXECUTE s4;
DEALLOCATE PREPARE s4;

SET @fk_sub_exist2 := IF(
  @has_sub > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_subscription'
     AND CONSTRAINT_NAME = 'fk_cln_operator_subscription_operatordetail'),
  1
);
SET @sql := IF(
  @has_od > 0 AND @has_sub > 0 AND @fk_sub_exist2 = 0,
  'ALTER TABLE `cln_operator_subscription` ADD CONSTRAINT `fk_cln_operator_subscription_operatordetail` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE s5 FROM @sql;
EXECUTE s5;
DEALLOCATE PREPARE s5;

SET @fk_addon_exist2 := IF(
  @has_addon > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_subscription_addon'
     AND CONSTRAINT_NAME = 'fk_cln_operator_subscription_addon_operatordetail'),
  1
);
SET @sql := IF(
  @has_od > 0 AND @has_addon > 0 AND @fk_addon_exist2 = 0,
  'ALTER TABLE `cln_operator_subscription_addon` ADD CONSTRAINT `fk_cln_operator_subscription_addon_operatordetail` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE s6 FROM @sql;
EXECUTE s6;
DEALLOCATE PREPARE s6;
