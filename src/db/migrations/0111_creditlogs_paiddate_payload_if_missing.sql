-- creditlogs 若缺 paiddate、payload 會導致 Stripe webhook UPDATE 報 Unknown column，Topup 一直 Pending。
-- Idempotent: 若列已存在會 ER_DUP_FIELDNAME，可忽略。

ALTER TABLE creditlogs ADD COLUMN paiddate datetime DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN payload text DEFAULT NULL;
