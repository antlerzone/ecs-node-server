-- manual-renew 時 handlePricingPlanPaymentSuccess 會 INSERT creditlogs 寫入 pricingplanlog_id、sourplan_id，缺列會 500。
-- Idempotent: 若列已存在會 ER_DUP_FIELDNAME，可忽略。

ALTER TABLE creditlogs ADD COLUMN pricingplanlog_id varchar(36) DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN sourplan_id varchar(36) DEFAULT NULL;
