-- creditlogs.txnid 可能缺失（例如表由舊版 init 建立）。Stripe webhook 更新 is_paid 時會寫 txnid，缺列會報 Unknown column 'txnid'，導致 Topup 一直 Pending。
-- Idempotent: 若列已存在會報 ER_DUP_FIELDNAME，可忽略。

ALTER TABLE creditlogs ADD COLUMN txnid varchar(255) DEFAULT NULL;
