-- agreement.status: legacy typo `complete` → canonical `completed` (tenant init filters on `completed` only).
UPDATE agreement
   SET status = 'completed', updated_at = UTC_TIMESTAMP()
 WHERE LOWER(TRIM(status)) = 'complete';
