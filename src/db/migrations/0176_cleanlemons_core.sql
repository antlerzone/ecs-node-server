-- Cleanlemons SaaS — core tables (Wix CSV import + future portal API).
-- FK: UUID strings as CHAR(36), project convention after 0087.
-- Engine InnoDB utf8mb4.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_client` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NULL,
  `name` VARCHAR(512) NULL,
  `phone` VARCHAR(64) NULL,
  `address` TEXT NULL,
  `bukku_contact_id` VARCHAR(64) NULL,
  `pic` VARCHAR(512) NULL,
  `wix_owner_id` CHAR(36) NULL COMMENT 'Wix CMS member/site owner id from export',
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_client_email` (`email`(191)),
  KEY `idx_cln_client_wix_owner` (`wix_owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_property` (
  `id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NULL COMMENT 'FK cln_client — Wix reference',
  `owner_wix_id` CHAR(36) NULL COMMENT 'Wix Owner field on Propertydetail',
  `property_name` VARCHAR(512) NULL,
  `contact` VARCHAR(255) NULL,
  `address` TEXT NULL,
  `score` INT NULL,
  `min_value` INT NULL COMMENT 'Wix column min',
  `team` VARCHAR(64) NULL,
  `client_label` VARCHAR(255) NULL COMMENT 'Wix Client display text',
  `unit_name` VARCHAR(255) NULL,
  `mailbox_password` TEXT NULL,
  `bed_count` INT NULL,
  `room_count` INT NULL,
  `bathroom_count` INT NULL,
  `kitchen` INT NULL,
  `living_room` INT NULL,
  `balcony` INT NULL,
  `staircase` INT NULL,
  `lift_level` VARCHAR(8) NULL,
  `special_area_count` INT NULL,
  `cleaning_fees` DECIMAL(14,2) NULL,
  `source_id` VARCHAR(64) NULL,
  `is_from_a` TINYINT(1) NULL,
  `cc_json` LONGTEXT NULL COMMENT 'checklist images / Wix cc field (raw export)',
  `warmcleaning` DECIMAL(14,2) NULL,
  `deepcleaning` DECIMAL(14,2) NULL,
  `generalcleaning` DECIMAL(14,2) NULL,
  `renovationcleaning` DECIMAL(14,2) NULL,
  `coliving_source_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_property_client` (`client_id`),
  KEY `idx_cln_property_team` (`team`),
  CONSTRAINT `fk_cln_property_client` FOREIGN KEY (`client_id`) REFERENCES `cln_client` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_schedule` (
  `id` CHAR(36) NOT NULL,
  `wix_item_url` VARCHAR(512) NULL,
  `owner_wix_id` CHAR(36) NULL,
  `working_day` DATETIME(3) NULL,
  `date_display` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `cleaning_type` VARCHAR(128) NULL,
  `submit_by` VARCHAR(255) NULL,
  `staff_start_email` VARCHAR(255) NULL,
  `start_time` DATETIME(3) NULL,
  `staff_end_email` VARCHAR(255) NULL,
  `end_time` DATETIME(3) NULL,
  `finalphoto_json` LONGTEXT NULL,
  `delay` INT NULL,
  `on_change_by` VARCHAR(255) NULL,
  `property_id` CHAR(36) NULL,
  `team` VARCHAR(64) NULL,
  `point` INT NULL,
  `on_change_time` DATETIME(3) NULL,
  `price` DECIMAL(14,2) NULL,
  `btob` TINYINT(1) NULL,
  `reservation_id` VARCHAR(64) NULL,
  `invoiced` TINYINT(1) NULL,
  `invoice_date` DATETIME(3) NULL,
  `updated_time_wix` DATETIME(3) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_schedule_property` (`property_id`),
  KEY `idx_cln_schedule_working_day` (`working_day`),
  KEY `idx_cln_schedule_team` (`team`),
  CONSTRAINT `fk_cln_schedule_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_attendance` (
  `id` CHAR(36) NOT NULL,
  `created_at_wix` DATETIME(3) NULL,
  `staff_id` CHAR(36) NULL COMMENT 'Wix StaffDetail ref in export',
  `check_out_time` DATETIME(3) NULL,
  `in_or_out` VARCHAR(32) NULL,
  `overtime` VARCHAR(64) NULL,
  `check_in_selfie` TEXT NULL,
  `check_out_selfie` TEXT NULL,
  `check_in_location` TEXT NULL,
  `check_out_location` TEXT NULL,
  `wix_owner_id` CHAR(36) NULL,
  `updated_at_wix` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_attendance_staff` (`staff_id`),
  KEY `idx_cln_attendance_created` (`created_at_wix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_feedback` (
  `id` CHAR(36) NOT NULL,
  `title` TEXT NULL,
  `wix_item_url` VARCHAR(512) NULL,
  `prove_json` LONGTEXT NULL,
  `submit_by` VARCHAR(255) NULL,
  `wix_owner_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_feedback_owner` (`wix_owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_damage` (
  `id` CHAR(36) NOT NULL,
  `wix_item_url` VARCHAR(512) NULL,
  `damage_photo_json` LONGTEXT NULL,
  `remark` TEXT NULL,
  `property_id` CHAR(36) NULL COMMENT 'Wix unitName column = property id',
  `staff_id` CHAR(36) NULL,
  `wix_owner_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_damage_property` (`property_id`),
  KEY `idx_cln_damage_staff` (`staff_id`),
  CONSTRAINT `fk_cln_damage_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_linens` (
  `id` CHAR(36) NOT NULL,
  `wix_owner_id` CHAR(36) NULL,
  `bedsheet` INT NULL,
  `check_flag` TINYINT(1) NULL,
  `linen_date` DATETIME(3) NULL,
  `futon` INT NULL,
  `team` VARCHAR(64) NULL,
  `towel` INT NULL,
  `bathmat` INT NULL,
  `user_email` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_linens_team_date` (`team`, `linen_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_kpi_deduction` (
  `id` CHAR(36) NOT NULL,
  `wix_owner_id` CHAR(36) NULL,
  `staff_email` VARCHAR(255) NULL,
  `event_date` DATETIME(3) NULL,
  `point` INT NULL,
  `reason` TEXT NULL,
  `added_by` VARCHAR(64) NULL,
  `salary` DECIMAL(20,4) NULL,
  `reference_id` CHAR(36) NULL,
  `team` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_kpi_staff_email` (`staff_email`(191)),
  KEY `idx_cln_kpi_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_client_invoice` (
  `id` CHAR(36) NOT NULL,
  `invoice_number` VARCHAR(64) NULL,
  `client_id` CHAR(36) NULL COMMENT 'Wix clientdetail id',
  `description` TEXT NULL,
  `amount` DECIMAL(14,2) NULL,
  `pdf_url` TEXT NULL,
  `transaction_id` VARCHAR(64) NULL,
  `payment_received` TINYINT(1) NULL,
  `balance_amount` DECIMAL(14,2) NULL,
  `wix_owner_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_inv_client` (`client_id`),
  CONSTRAINT `fk_cln_invoice_client` FOREIGN KEY (`client_id`) REFERENCES `cln_client` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_client_payment` (
  `id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NULL,
  `receipt_number` VARCHAR(64) NULL,
  `amount` DECIMAL(14,2) NULL,
  `payment_date` DATE NULL,
  `receipt_url` TEXT NULL,
  `transaction_id` VARCHAR(64) NULL,
  `invoice_id` CHAR(36) NULL,
  `wix_owner_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_pay_client` (`client_id`),
  KEY `idx_cln_pay_invoice` (`invoice_id`),
  CONSTRAINT `fk_cln_payment_client` FOREIGN KEY (`client_id`) REFERENCES `cln_client` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_payment_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `cln_client_invoice` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
