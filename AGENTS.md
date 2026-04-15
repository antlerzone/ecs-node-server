# AGENTS.md

## Cursor Cloud specific instructions

### Architecture overview

This is a monorepo with **two products** served from a single Express backend:

| Service | Directory | Port | Command |
|---------|-----------|------|---------|
| **Backend API** (Coliving + Cleanlemons) | `/workspace` | 5000 | `npm run dev` (nodemon) or `npm start` |
| **Coliving Portal** (Next.js 16) | `/workspace/docs/nextjs-migration` | 3001 | `npm run dev` |
| **Cleanlemons Portal** (Next.js 16) | `/workspace/cleanlemon/next-app` | 3100 | `npm run dev` |

All three share a single **MySQL** database. The backend serves Coliving routes at `/api/*` and Cleanlemons routes at `/api/cleanlemon/*`.

### MySQL setup (first time only)

MySQL 8 must be installed and running. Create the database and user:

```sql
CREATE DATABASE IF NOT EXISTS coliving_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'coliving'@'localhost' IDENTIFIED BY 'coliving_dev_pass';
GRANT ALL PRIVILEGES ON coliving_dev.* TO 'coliving'@'localhost';
FLUSH PRIVILEGES;
```

Start mysqld before the backend: `sudo mysqld --user=mysql &`

### .env files

- **Backend** (`/workspace/.env`): needs `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT=5000`, `PORTAL_JWT_SECRET`.
- **Coliving portal** (`docs/nextjs-migration/.env`): needs `NEXT_PUBLIC_ECS_BASE_URL=http://127.0.0.1:5000` and `ECS_BASE_URL=http://127.0.0.1:5000`.
- **Cleanlemons portal** (`cleanlemon/next-app/.env`): needs `NEXT_PUBLIC_CLEANLEMON_API_URL=http://127.0.0.1:5000`.

### Running migrations

The 0001_init.sql migration has FK dependency ordering issues with MySQL 8. To bootstrap from scratch, first run:

```bash
sudo mysql -u root coliving_dev -e "SET FOREIGN_KEY_CHECKS=0; SOURCE src/db/migrations/0001_init.sql; SET FOREIGN_KEY_CHECKS=1;"
```

Then run the remaining migrations (some may fail on MySQL 8 reserved words like `system`; the `account_client` table from 0052 needs manual creation with backtick-quoted `system` column):

```bash
bash scripts/run-all-migrations.sh
```

### Gotchas

- **No ESLint config**: the `lint` scripts in both Next.js `package.json` files call `eslint .` but there is no `eslint.config.*` or `.eslintrc*` in the repo. TypeScript checking (`npx tsc --noEmit`) works but has pre-existing type errors.
- **MySQL 8 reserved words**: migration 0052 uses `system` as a column name without backticks, which fails on MySQL 8. Create the `account_client` table manually with backtick-quoted column names.
- **Three separate `npm install`**: dependencies must be installed independently in the root, `docs/nextjs-migration/`, and `cleanlemon/next-app/` directories.
- **Backend hot reload**: `npm run dev` uses nodemon. If you add new npm packages, restart the dev server.
- **Next.js 16**: `next lint` no longer exists as a CLI subcommand in Next.js 16.

### Running services for development

1. Start MySQL: `sudo mysqld --user=mysql &` (or via tmux)
2. Start backend: `cd /workspace && npm run dev`
3. Start Coliving portal: `cd /workspace/docs/nextjs-migration && npm run dev -- -p 3001`
4. Start Cleanlemons portal: `cd /workspace/cleanlemon/next-app && npm run dev -- -p 3100`

### Key API endpoints for testing

- `GET /` → `{"ok":true,"message":"server running"}` (health check)
- `GET /api/enquiry/plans` → pricing plans
- `GET /api/enquiry/credit-plans` → credit top-up plans (queries MySQL)
- `GET /api/availableunit/list` → available rental units
