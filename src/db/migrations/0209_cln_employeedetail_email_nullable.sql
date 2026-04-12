-- Allow operator contacts / BUKKU import without email (cln_clientdetail.email was already nullable).
SET NAMES utf8mb4;

ALTER TABLE `cln_employeedetail`
  MODIFY COLUMN `email` VARCHAR(255) NULL;
