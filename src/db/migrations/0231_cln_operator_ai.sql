-- Cleanlemons: per-operator AI schedule settings + chat; optional lock on schedule rows for AI.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_operator_ai` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `region_groups_json` LONGTEXT NULL COMMENT 'JSON array of { id, name?, propertyIds: [] }',
  `pinned_constraints_json` LONGTEXT NULL COMMENT 'JSON array of { type, propertyId, teamIds, note? }',
  `schedule_prefs_json` LONGTEXT NULL COMMENT 'JSON toggles, buffer, capacity hints',
  `prompt_extra` TEXT NULL,
  `chat_summary` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cln_operator_ai_operator` (`operator_id`),
  KEY `idx_cln_operator_ai_updated` (`updated_at`),
  CONSTRAINT `fk_cln_operator_ai_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_operator_ai_chat_message` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `role` VARCHAR(16) NOT NULL COMMENT 'user | assistant | system',
  `content` MEDIUMTEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_operator_ai_chat_op_created` (`operator_id`, `created_at`),
  CONSTRAINT `fk_cln_operator_ai_chat_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional: prevent AI from overwriting operator-assigned teams
SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'ai_assignment_locked'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `ai_assignment_locked` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=do not change team via AI'' AFTER `team`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
