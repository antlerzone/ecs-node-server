#!/bin/bash
# Run each 0033 ALTER separately; ignore errors (e.g. duplicate column/key).
# Usage: cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && bash scripts/run-0033-agreement-columns-idempotent.sh

set -e
export $(grep -v '^#' .env | xargs)

run() {
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "$1" 2>/dev/null || true
}

run "ALTER TABLE agreement ADD COLUMN owner_id varchar(36) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN property_id varchar(36) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN tenancy_id varchar(36) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN agreementtemplate_id varchar(36) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN mode varchar(50) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN status varchar(50) DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN ownersign text DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN owner_signed_at datetime DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN tenantsign text DEFAULT NULL;"
run "ALTER TABLE agreement ADD COLUMN pdfurl varchar(500) DEFAULT NULL;"

run "ALTER TABLE agreement ADD KEY idx_agreement_owner_id (owner_id);"
run "ALTER TABLE agreement ADD KEY idx_agreement_status (status);"
run "ALTER TABLE agreement ADD KEY idx_agreement_mode (mode);"

echo "Done. Check agreement table: mysql ... -e 'DESCRIBE agreement;'"
