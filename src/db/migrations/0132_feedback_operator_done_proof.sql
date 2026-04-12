-- Operator approval: store completion date + operator-uploaded proof photos separately from tenant submission photos
ALTER TABLE feedback
  ADD COLUMN operator_done_at datetime DEFAULT NULL COMMENT 'When operator marked feedback done (chosen date)',
  ADD COLUMN operator_done_photo text DEFAULT NULL COMMENT 'JSON array of { src, type } uploaded by operator on done';
