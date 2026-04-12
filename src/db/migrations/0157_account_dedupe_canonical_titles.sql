-- Merge duplicate `account` rows that share the same display title as a canonical template but have a non-canonical `id`.
-- Cause: 0156 used INSERT ... ON DUPLICATE KEY UPDATE on `id` only; if an older row already had e.g. "Forfeit Deposit"
-- with a different UUID, 0156 still inserted the canonical row → two rows, same title.
-- This migration: repoint rentalcollection.type_id + account_client.account_id to the canonical id, then delete extras.
-- Safe to run multiple times.
-- Run: node scripts/run-migration.js src/db/migrations/0157_account_dedupe_canonical_titles.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Expects the canonical UUID row to exist for each template name (0156). Merges FKs onto it and deletes duplicate titles.

-- Forfeit Deposit
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '2020b22b-028e-4216-906c-c816dcb33a85' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Forfeit Deposit' AND a.id <> '2020b22b-028e-4216-906c-c816dcb33a85';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '2020b22b-028e-4216-906c-c816dcb33a85' WHERE TRIM(a.title) = 'Forfeit Deposit' AND a.id <> '2020b22b-028e-4216-906c-c816dcb33a85';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '2020b22b-028e-4216-906c-c816dcb33a85' WHERE TRIM(a.title) = 'Forfeit Deposit' AND a.id <> '2020b22b-028e-4216-906c-c816dcb33a85';
DELETE FROM account WHERE TRIM(title) = 'Forfeit Deposit' AND id <> '2020b22b-028e-4216-906c-c816dcb33a85';

-- Management Fees
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'a1b2c3d4-0002-4000-8000-000000000002' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Management Fees' AND a.id <> 'a1b2c3d4-0002-4000-8000-000000000002';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'a1b2c3d4-0002-4000-8000-000000000002' WHERE TRIM(a.title) = 'Management Fees' AND a.id <> 'a1b2c3d4-0002-4000-8000-000000000002';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'a1b2c3d4-0002-4000-8000-000000000002' WHERE TRIM(a.title) = 'Management Fees' AND a.id <> 'a1b2c3d4-0002-4000-8000-000000000002';
DELETE FROM account WHERE TRIM(title) = 'Management Fees' AND id <> 'a1b2c3d4-0002-4000-8000-000000000002';

-- Other (keep canonical income row, drop duplicate Other asset/income extras)
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '94b4e060-3999-4c76-8189-f969615c0a7d' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Other' AND a.id <> '94b4e060-3999-4c76-8189-f969615c0a7d';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '94b4e060-3999-4c76-8189-f969615c0a7d' WHERE TRIM(a.title) = 'Other' AND a.id <> '94b4e060-3999-4c76-8189-f969615c0a7d';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '94b4e060-3999-4c76-8189-f969615c0a7d' WHERE TRIM(a.title) = 'Other' AND a.id <> '94b4e060-3999-4c76-8189-f969615c0a7d';
DELETE FROM account WHERE TRIM(title) = 'Other' AND id <> '94b4e060-3999-4c76-8189-f969615c0a7d';

-- Bank
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '1c7e41b6-9d57-4c03-8122-a76baad3b592' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Bank' AND a.id <> '1c7e41b6-9d57-4c03-8122-a76baad3b592';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '1c7e41b6-9d57-4c03-8122-a76baad3b592' WHERE TRIM(a.title) = 'Bank' AND a.id <> '1c7e41b6-9d57-4c03-8122-a76baad3b592';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '1c7e41b6-9d57-4c03-8122-a76baad3b592' WHERE TRIM(a.title) = 'Bank' AND a.id <> '1c7e41b6-9d57-4c03-8122-a76baad3b592';
DELETE FROM account WHERE TRIM(title) = 'Bank' AND id <> '1c7e41b6-9d57-4c03-8122-a76baad3b592';

-- Cash
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'a1b2c3d4-0001-4000-8000-000000000001' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Cash' AND a.id <> 'a1b2c3d4-0001-4000-8000-000000000001';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'a1b2c3d4-0001-4000-8000-000000000001' WHERE TRIM(a.title) = 'Cash' AND a.id <> 'a1b2c3d4-0001-4000-8000-000000000001';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'a1b2c3d4-0001-4000-8000-000000000001' WHERE TRIM(a.title) = 'Cash' AND a.id <> 'a1b2c3d4-0001-4000-8000-000000000001';
DELETE FROM account WHERE TRIM(title) = 'Cash' AND id <> 'a1b2c3d4-0001-4000-8000-000000000001';

-- Stripe
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '26a35506-0631-4d79-9b4f-a8195b69c8ed' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Stripe' AND a.id <> '26a35506-0631-4d79-9b4f-a8195b69c8ed';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '26a35506-0631-4d79-9b4f-a8195b69c8ed' WHERE TRIM(a.title) = 'Stripe' AND a.id <> '26a35506-0631-4d79-9b4f-a8195b69c8ed';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '26a35506-0631-4d79-9b4f-a8195b69c8ed' WHERE TRIM(a.title) = 'Stripe' AND a.id <> '26a35506-0631-4d79-9b4f-a8195b69c8ed';
DELETE FROM account WHERE TRIM(title) = 'Stripe' AND id <> '26a35506-0631-4d79-9b4f-a8195b69c8ed';

-- Xendit
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Xendit' AND a.id <> 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10' WHERE TRIM(a.title) = 'Xendit' AND a.id <> 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10' WHERE TRIM(a.title) = 'Xendit' AND a.id <> 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';
DELETE FROM account WHERE TRIM(title) = 'Xendit' AND id <> 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';

-- Deposit
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '18ba3daf-7208-46fc-8e97-43f34e898401' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Deposit' AND a.id <> '18ba3daf-7208-46fc-8e97-43f34e898401';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '18ba3daf-7208-46fc-8e97-43f34e898401' WHERE TRIM(a.title) = 'Deposit' AND a.id <> '18ba3daf-7208-46fc-8e97-43f34e898401';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '18ba3daf-7208-46fc-8e97-43f34e898401' WHERE TRIM(a.title) = 'Deposit' AND a.id <> '18ba3daf-7208-46fc-8e97-43f34e898401';
DELETE FROM account WHERE TRIM(title) = 'Deposit' AND id <> '18ba3daf-7208-46fc-8e97-43f34e898401';

-- Platform Collection
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'a1b2c3d4-0003-4000-8000-000000000003' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Platform Collection' AND a.id <> 'a1b2c3d4-0003-4000-8000-000000000003';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'a1b2c3d4-0003-4000-8000-000000000003' WHERE TRIM(a.title) = 'Platform Collection' AND a.id <> 'a1b2c3d4-0003-4000-8000-000000000003';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'a1b2c3d4-0003-4000-8000-000000000003' WHERE TRIM(a.title) = 'Platform Collection' AND a.id <> 'a1b2c3d4-0003-4000-8000-000000000003';
DELETE FROM account WHERE TRIM(title) = 'Platform Collection' AND id <> 'a1b2c3d4-0003-4000-8000-000000000003';

-- Owner Commission
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Owner Commission' AND a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' WHERE TRIM(a.title) = 'Owner Commission' AND a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' WHERE TRIM(a.title) = 'Owner Commission' AND a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
DELETE FROM account WHERE TRIM(title) = 'Owner Commission' AND id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a';

-- Tenant Commission
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'e1b2c3d4-2002-4000-8000-000000000302' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Tenant Commission' AND a.id <> 'e1b2c3d4-2002-4000-8000-000000000302';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'e1b2c3d4-2002-4000-8000-000000000302' WHERE TRIM(a.title) = 'Tenant Commission' AND a.id <> 'e1b2c3d4-2002-4000-8000-000000000302';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'e1b2c3d4-2002-4000-8000-000000000302' WHERE TRIM(a.title) = 'Tenant Commission' AND a.id <> 'e1b2c3d4-2002-4000-8000-000000000302';
DELETE FROM account WHERE TRIM(title) = 'Tenant Commission' AND id <> 'e1b2c3d4-2002-4000-8000-000000000302';

-- Agreement Fees
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'e1b2c3d4-2003-4000-8000-000000000303' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Agreement Fees' AND a.id <> 'e1b2c3d4-2003-4000-8000-000000000303';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'e1b2c3d4-2003-4000-8000-000000000303' WHERE TRIM(a.title) = 'Agreement Fees' AND a.id <> 'e1b2c3d4-2003-4000-8000-000000000303';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'e1b2c3d4-2003-4000-8000-000000000303' WHERE TRIM(a.title) = 'Agreement Fees' AND a.id <> 'e1b2c3d4-2003-4000-8000-000000000303';
DELETE FROM account WHERE TRIM(title) = 'Agreement Fees' AND id <> 'e1b2c3d4-2003-4000-8000-000000000303';

-- Topup Aircond
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'a1b2c3d4-1001-4000-8000-000000000101' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Topup Aircond' AND a.id <> 'a1b2c3d4-1001-4000-8000-000000000101';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'a1b2c3d4-1001-4000-8000-000000000101' WHERE TRIM(a.title) = 'Topup Aircond' AND a.id <> 'a1b2c3d4-1001-4000-8000-000000000101';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'a1b2c3d4-1001-4000-8000-000000000101' WHERE TRIM(a.title) = 'Topup Aircond' AND a.id <> 'a1b2c3d4-1001-4000-8000-000000000101';
DELETE FROM account WHERE TRIM(title) = 'Topup Aircond' AND id <> 'a1b2c3d4-1001-4000-8000-000000000101';

-- Rental Income
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Rental Income' AND a.id <> 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3' WHERE TRIM(a.title) = 'Rental Income' AND a.id <> 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3' WHERE TRIM(a.title) = 'Rental Income' AND a.id <> 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';
DELETE FROM account WHERE TRIM(title) = 'Rental Income' AND id <> 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';

-- Parking Fees
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'e1b2c3d4-2004-4000-8000-000000000304' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Parking Fees' AND a.id <> 'e1b2c3d4-2004-4000-8000-000000000304';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'e1b2c3d4-2004-4000-8000-000000000304' WHERE TRIM(a.title) = 'Parking Fees' AND a.id <> 'e1b2c3d4-2004-4000-8000-000000000304';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'e1b2c3d4-2004-4000-8000-000000000304' WHERE TRIM(a.title) = 'Parking Fees' AND a.id <> 'e1b2c3d4-2004-4000-8000-000000000304';
DELETE FROM account WHERE TRIM(title) = 'Parking Fees' AND id <> 'e1b2c3d4-2004-4000-8000-000000000304';

-- Referral Fees
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'e1b2c3d4-2006-4000-8000-000000000306' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Referral Fees' AND a.id <> 'e1b2c3d4-2006-4000-8000-000000000306';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'e1b2c3d4-2006-4000-8000-000000000306' WHERE TRIM(a.title) = 'Referral Fees' AND a.id <> 'e1b2c3d4-2006-4000-8000-000000000306';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'e1b2c3d4-2006-4000-8000-000000000306' WHERE TRIM(a.title) = 'Referral Fees' AND a.id <> 'e1b2c3d4-2006-4000-8000-000000000306';
DELETE FROM account WHERE TRIM(title) = 'Referral Fees' AND id <> 'e1b2c3d4-2006-4000-8000-000000000306';

-- Processing Fees
DELETE ac_dup FROM account_client ac_dup INNER JOIN account a ON a.id = ac_dup.account_id INNER JOIN account_client ac_keep ON ac_keep.account_id = 'e1b2c3d4-2007-4000-8000-000000000307' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system WHERE TRIM(a.title) = 'Processing Fees' AND a.id <> 'e1b2c3d4-2007-4000-8000-000000000307';
UPDATE rentalcollection r INNER JOIN account a ON a.id = r.type_id SET r.type_id = 'e1b2c3d4-2007-4000-8000-000000000307' WHERE TRIM(a.title) = 'Processing Fees' AND a.id <> 'e1b2c3d4-2007-4000-8000-000000000307';
UPDATE account_client ac INNER JOIN account a ON a.id = ac.account_id SET ac.account_id = 'e1b2c3d4-2007-4000-8000-000000000307' WHERE TRIM(a.title) = 'Processing Fees' AND a.id <> 'e1b2c3d4-2007-4000-8000-000000000307';
DELETE FROM account WHERE TRIM(title) = 'Processing Fees' AND id <> 'e1b2c3d4-2007-4000-8000-000000000307';
