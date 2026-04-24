-- Pending B2B client invoice online checkout (Billplz / Xendit).
CREATE TABLE IF NOT EXISTS `cln_b2b_invoice_checkout` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `clientdetail_id` CHAR(36) NOT NULL,
  `invoice_ids` TEXT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `provider` VARCHAR(16) NOT NULL,
  `billplz_bill_id` VARCHAR(64) NULL,
  `xendit_invoice_id` VARCHAR(128) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_b2b_chk_op` (`operator_id`),
  KEY `idx_cln_b2b_chk_bp` (`billplz_bill_id`),
  KEY `idx_cln_b2b_chk_xi` (`xendit_invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
