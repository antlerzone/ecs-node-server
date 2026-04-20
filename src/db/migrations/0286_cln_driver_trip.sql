-- Cleanlemons: employee driver route orders (pickup/dropoff), driver accept vs operator-booked Grab.
-- Run: node scripts/run-migration.js src/db/migrations/0286_cln_driver_trip.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_driver_trip'
);
SET @sql_create := IF(
  @tbl_exists = 0,
  'CREATE TABLE `cln_driver_trip` (
    `id` CHAR(36) NOT NULL,
    `operator_id` CHAR(36) NOT NULL,
    `requester_employee_id` CHAR(36) NOT NULL,
    `requester_email` VARCHAR(255) NOT NULL,
    `pickup_text` VARCHAR(2000) NOT NULL,
    `dropoff_text` VARCHAR(2000) NOT NULL,
    `schedule_offset` ENUM(''now'',''15'',''30'') NOT NULL DEFAULT ''now'',
    `order_time_utc` DATETIME(3) NOT NULL,
    `business_time_zone` VARCHAR(64) NOT NULL DEFAULT ''Asia/Kuala_Lumpur'',
    `status` ENUM(''pending'',''driver_accepted'',''grab_booked'',''completed'',''cancelled'') NOT NULL DEFAULT ''pending'',
    `fulfillment_type` ENUM(''none'',''driver'',''grab'') NOT NULL DEFAULT ''none'',
    `accepted_driver_employee_id` CHAR(36) NULL,
    `accepted_at_utc` DATETIME(3) NULL,
    `grab_car_plate` VARCHAR(64) NULL,
    `grab_phone` VARCHAR(64) NULL,
    `grab_proof_image_url` VARCHAR(2000) NULL,
    `grab_booked_by_email` VARCHAR(255) NULL,
    `grab_booked_at_utc` DATETIME(3) NULL,
    `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_cln_driver_trip_operator_status_time` (`operator_id`, `status`, `order_time_utc`),
    KEY `idx_cln_driver_trip_requester_active` (`requester_employee_id`, `operator_id`, `status`),
    KEY `idx_cln_driver_trip_created` (`operator_id`, `created_at_utc`),
    CONSTRAINT `fk_cln_driver_trip_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt_create FROM @sql_create;
EXECUTE stmt_create;
DEALLOCATE PREPARE stmt_create;
