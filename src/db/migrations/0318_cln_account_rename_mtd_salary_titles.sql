-- Operator accounting default chart labels (portal list + salary accrual title lookup).
SET NAMES utf8mb4;

UPDATE `cln_account`
SET `title` = 'MTD - Employer''s Contribution'
WHERE `id` = 'e0c10001-0000-4000-8000-000000000024';

UPDATE `cln_account`
SET `title` = 'Salaries & Wages'
WHERE `id` = 'e0c10001-0000-4000-8000-000000000013';
