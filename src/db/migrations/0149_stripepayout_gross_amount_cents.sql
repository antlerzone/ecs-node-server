-- stripepayout: store tenant gross per aggregated day so settlement journals can split 97% / 2% / 1%.
-- total_amount_cents = sum of transfers to Connect (operator net); gross_amount_cents = sum of PaymentIntent gross.

ALTER TABLE stripepayout ADD COLUMN gross_amount_cents bigint DEFAULT NULL;
