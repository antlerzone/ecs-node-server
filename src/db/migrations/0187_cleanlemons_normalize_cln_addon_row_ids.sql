-- After clm_addon → cln_addon rename, primary key `id` values may still be clm-addon-*.
SET NAMES utf8mb4;
UPDATE `cln_addon` SET id = 'cln-addon-bulk-transfer' WHERE id = 'clm-addon-bulk-transfer';
UPDATE `cln_addon` SET id = 'cln-addon-api-integration' WHERE id = 'clm-addon-api-integration';
