-- Add WiFi username and password to propertydetail for tenant portal display.
-- Operator sets these in Property Setting — tenant sees them after move-in.
-- Run once: node scripts/run-migration.js src/db/migrations/0105_propertydetail_wifi_username_password.sql

ALTER TABLE propertydetail
  ADD COLUMN wifi_username VARCHAR(255) DEFAULT NULL AFTER wifidetail,
  ADD COLUMN wifi_password VARCHAR(255) DEFAULT NULL AFTER wifi_username;
