-- Remote unlock audit log (Node → TTLock /lock/unlock success). Run: node scripts/run-migration.js src/db/migrations/0238_lockdetail_log.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `lockdetail_log` (
  `id` CHAR(36) NOT NULL,
  `lockdetail_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actor_email` VARCHAR(255) NOT NULL,
  `open_method` VARCHAR(32) NOT NULL DEFAULT 'web_portal_remote',
  `portal_source` VARCHAR(40) NULL,
  `job_id` CHAR(36) NULL,
  `ok` TINYINT(1) NOT NULL DEFAULT 1,
  `error_reason` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lockdetail_log_created` (`created_at`),
  KEY `idx_lockdetail_log_lock` (`lockdetail_id`),
  KEY `idx_lockdetail_log_email` (`actor_email`(64)),
  CONSTRAINT `fk_lockdetail_log_lock` FOREIGN KEY (`lockdetail_id`) REFERENCES `lockdetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
