# Migration Numbering Governance

This project currently has historical duplicate migration prefixes (same `NNNN_` used by multiple files).
We will **not rename old migrations** to avoid breaking environment history.

## Current Duplicate Prefixes (historical)

- `0033`: `0033_agreement_owner_portal_columns.sql`, `0033_agreement_pdf_columns.sql`
- `0040`: `0040_account_provider.sql`, `0040_rentalcollection_import_columns.sql`
- `0044`: `0044_feedback_done_remark.sql`, `0044_propertydetail_folder.sql`, `0044_supplierdetail_account.sql`
- `0051`: `0051_account_drop_accountid_productid.sql`, `0051_roomdetail_backfill_meter_smartdoor_id.sql`
- `0058`: `0058_create_stripepayout.sql`, `0058_ticket_api_error_columns.sql`
- `0086`: `0086_portal_account_full_profile.sql`, `0086_portal_password_reset.sql`
- `0087`: `0087_portal_account_name_idtype.sql`, `0087_wixid_to_id_replace_and_drop_wixid_columns.sql`

## Rule For New Migrations

- Always use a new unique `NNNN_` prefix.
- Never reuse an existing prefix, even if the old migration is unrelated.
- Keep incrementing from the current max (`0142` at time of writing).

## Pre-check Command

Run before committing migrations:

```bash
npm run migrate:check-prefix
```

This command fails when duplicate prefixes are present, so new collisions can be caught early.

## Practical Policy

- Accept existing historical duplicates as legacy.
- Block any **new** duplicate prefixes.
- If we ever migrate to a formal migration table/tool, keep this rule until cutover is complete.
