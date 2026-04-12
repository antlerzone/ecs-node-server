-- Cleanlemons: 从 `address` 文本中解析 Waze / Google Maps 链接写入专用列，并尽量清理地址字段。
-- 依赖：0235（或下列 idempotent ADD）。需 MySQL 8.0+（REGEXP_SUBSTR / REGEXP_REPLACE）。
-- Run: node scripts/run-migration.js src/db/migrations/0236_cln_property_backfill_waze_google_from_address.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'waze_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `waze_url` TEXT NULL COMMENT ''Waze deep link'' AFTER `address`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'google_maps_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `google_maps_url` TEXT NULL COMMENT ''Google Maps share URL'' AFTER `waze_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- Waze：优先匹配 /ul/ 段（避免与后面粘连的英文粘连，如 ...vc1Google...）----------
UPDATE `cln_property`
SET `waze_url` = REGEXP_SUBSTR(`address`, 'https?://(?:www\\.)?waze\\.com/ul/[a-zA-Z0-9]+')
WHERE (NULLIF(TRIM(`waze_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'waze\\.com/ul/';

UPDATE `cln_property`
SET `waze_url` = REGEXP_SUBSTR(`address`, 'https?://[^[:space:]]*waze\\.com[^[:space:]]*')
WHERE (NULLIF(TRIM(`waze_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'waze\\.com';

-- ---------- Google Maps：短链、goo.gl、google.com/maps、maps.google.com ----------
UPDATE `cln_property`
SET `google_maps_url` = REGEXP_SUBSTR(`address`, 'https?://[^[:space:]]*maps\\.app\\.goo\\.gl[^[:space:]]*')
WHERE (NULLIF(TRIM(`google_maps_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'maps\\.app\\.goo\\.gl';

UPDATE `cln_property`
SET `google_maps_url` = REGEXP_SUBSTR(`address`, 'https?://[^[:space:]]*goo\\.gl[^[:space:]]*')
WHERE (NULLIF(TRIM(`google_maps_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'goo\\.gl';

UPDATE `cln_property`
SET `google_maps_url` = REGEXP_SUBSTR(`address`, 'https?://[^[:space:]]*google\\.com/maps[^[:space:]]*')
WHERE (NULLIF(TRIM(`google_maps_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'google\\.com/maps';

UPDATE `cln_property`
SET `google_maps_url` = REGEXP_SUBSTR(`address`, 'https?://[^[:space:]]*maps\\.google\\.com[^[:space:]]*')
WHERE (NULLIF(TRIM(`google_maps_url`), '') IS NULL)
  AND `address` IS NOT NULL
  AND `address` REGEXP 'maps\\.google\\.com';

-- ---------- 从 address 中去掉已识别的 URL 片段（仅当 address 仍含 http）----------
UPDATE `cln_property`
SET `address` = TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            COALESCE(`address`, ''),
            'https?://(?:www\\.)?waze\\.com/ul/[a-zA-Z0-9]+',
            ''
          ),
          'https?://[^[:space:]]*waze\\.com[^[:space:]]*',
          ''
        ),
        'https?://[^[:space:]]*maps\\.app\\.goo\\.gl[^[:space:]]*',
        ''
      ),
      'https?://[^[:space:]]*goo\\.gl[^[:space:]]*',
      ''
    ),
    'https?://[^[:space:]]*(google\\.com/maps|maps\\.google\\.com)[^[:space:]]*',
    ''
  )
)
WHERE `address` IS NOT NULL
  AND `address` REGEXP 'https?://';

-- 去掉常见英文标签与重复空白（避免 (?i) 兼容性差异，分条 REGEXP_REPLACE）
UPDATE `cln_property`
SET `address` = TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(COALESCE(`address`, ''), 'Waze\\s*:\\s*', ''),
          'waze\\s*:\\s*',
          ''
        ),
        'Google Maps\\s*:\\s*',
        ''
      ),
      'Google Map\\s*:\\s*',
      ''
    ),
    '[[:space:]]{2,}',
    ' '
  )
)
WHERE `address` IS NOT NULL
  AND (
    `address` LIKE '%Waze:%'
    OR `address` LIKE '%waze:%'
    OR `address` LIKE '%Google Map:%'
    OR `address` LIKE '%Google Maps:%'
  );
