-- Owner signing audit hash.
-- owner_signed_hash = SHA256(agreementId + ownersign + owner_signed_at + hash_draft)

ALTER TABLE agreement ADD COLUMN owner_signed_hash varchar(64) DEFAULT NULL COMMENT 'SHA256 audit for owner sign event';
