-- Align cln_pricingplanlog string columns with cln_operator_subscription / cln_operatordetail (utf8mb4_unicode_ci).
-- Prevents: Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT) on operator_id joins.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_pricingplanlog'
);

SET @sql := IF(
  @has > 0,
  'ALTER TABLE cln_pricingplanlog
     MODIFY operator_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
     MODIFY subscription_addon_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY log_kind VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
     MODIFY source VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY scenario VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY plan_code VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY billing_cycle VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY addon_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY stripe_session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY invoice_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     MODIFY invoice_url VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
