# Cleanlemons (Node on ECS)

Mounted at **`/api/cleanlemon`** (see `server.js`). Data lives in MySQL tables `cln_*` (migration `src/db/migrations/0176_cleanlemons_core.sql`).

## Endpoints

- `GET /api/cleanlemon/health` — DB ping + count of `cln_%` tables
- `GET /api/cleanlemon/stats` — row counts (clients, properties, schedules)
- `GET /api/cleanlemon/properties?limit=&offset=`
- `GET /api/cleanlemon/schedules?limit=&offset=`

## CSV import (Wix export)

```bash
node scripts/run-migration.js src/db/migrations/0176_cleanlemons_core.sql
node scripts/import-cleanlemons-csv.js
# optional: CLEANLEMON_CSV_DIR=/path/to/csvs
```

Default CSV dir: `cleanlemon/next-app/`.

## Portal Next.js

Set `NEXT_PUBLIC_CLEANLEMON_API_URL` to the ECS Node origin (no trailing slash). `app/portal/api-integration` calls `/health` and `/stats`.

## Operator Team page rules (`/operator/team`)

- Header actions:
  - Right side has tabs: `Team List` and `Calendar`.
  - `Create Team` remains a dialog action button.
- Calendar:
  - Use large month-view grid (same visual scale as `/operator/calender`).
  - Each day cell shows rest badges for teams whose `restDays` includes that weekday.
  - Team badge colors are fixed per team (same team keeps same color across all dates).
- Team membership constraints:
  - One staff can belong to only one team.
  - In member picker, staff already assigned to another team must be disabled and labeled `Already in <Team Name>`.
  - Save/create must enforce the same rule again as server-side-style validation fallback (block submit when conflict exists).
