-- Tenant smart door: separate PIN + TTLock keyboardPwdId for property vs room locks (tenant portal scope: all / property / room).
ALTER TABLE tenancy
  ADD COLUMN password_property VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN password_room VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN passwordid_property INT NULL DEFAULT NULL,
  ADD COLUMN passwordid_room INT NULL DEFAULT NULL;
