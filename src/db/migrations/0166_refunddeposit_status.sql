ALTER TABLE refunddeposit
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'pending' AFTER done;

UPDATE refunddeposit
SET status = CASE
  WHEN done = 1 THEN 'completed'
  WHEN status IS NULL OR TRIM(status) = '' THEN 'pending'
  ELSE LOWER(status)
END;

ALTER TABLE refunddeposit
  ADD KEY idx_refunddeposit_status (status);
