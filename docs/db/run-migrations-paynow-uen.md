# Run migrations (paste in terminal)

From project root (where `package.json` and `scripts/` are):

```bash
node scripts/run-migration.js src/db/migrations/0119_client_profile_paynow_qr.sql
```

```bash
node scripts/run-migration.js src/db/migrations/0120_paynow_qr_log.sql
```

```bash
node scripts/run-migration.js src/db/migrations/0121_client_profile_uen.sql
```

Or run all three in one go:

```bash
node scripts/run-migration.js src/db/migrations/0119_client_profile_paynow_qr.sql && node scripts/run-migration.js src/db/migrations/0120_paynow_qr_log.sql && node scripts/run-migration.js src/db/migrations/0121_client_profile_uen.sql
```

Ensure `.env` has correct `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` before running.
