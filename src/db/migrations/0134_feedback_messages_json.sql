-- Feedback: threaded operator/tenant messages (append-only replies)
ALTER TABLE feedback ADD COLUMN messages_json JSON DEFAULT NULL COMMENT 'Thread [{role: operator|tenant, text, at}]';
