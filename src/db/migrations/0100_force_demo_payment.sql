-- Force all clients to demo/sandbox payment until go-live.
-- Run when ECS is in demo phase (portal + all clients use test/sandbox Stripe & Xendit).
-- Revert by: UPDATE client_profile SET stripe_sandbox = 0; and set xendit_use_test=0 in client_integration as needed; then unset FORCE_PAYMENT_SANDBOX in .env.

-- 1) All clients use Stripe sandbox (test mode)
UPDATE client_profile SET stripe_sandbox = 1;

-- 2) All Xendit (payex) integrations use test key
UPDATE client_integration
SET values_json = JSON_SET(COALESCE(values_json, CAST('{}' AS JSON)), '$.xendit_use_test', 1)
WHERE `key` = 'paymentGateway' AND provider = 'payex';
