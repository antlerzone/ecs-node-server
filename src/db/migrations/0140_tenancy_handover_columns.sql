-- Tenancy handover proof (operator portal check-in / check-out)
ALTER TABLE tenancy
  ADD COLUMN handover_checkin_json JSON NULL COMMENT 'Check-in handover proof: handover card photos, unit photos, tenant signature',
  ADD COLUMN handover_checkout_json JSON NULL COMMENT 'Check-out handover proof: handover card photos, unit photos, tenant signature';
