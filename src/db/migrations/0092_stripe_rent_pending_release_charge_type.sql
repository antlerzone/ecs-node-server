-- Add charge_type to pending release so we can release invoice/meter with correct creditlog.charge_type.
-- Values: 'rental' (rent + invoice), 'meter'.

ALTER TABLE stripe_rent_pending_release
  ADD COLUMN charge_type varchar(50) NOT NULL DEFAULT 'rental' AFTER payment_intent_id;
