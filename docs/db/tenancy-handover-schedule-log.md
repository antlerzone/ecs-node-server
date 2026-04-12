# Handover appointment time — audit log

When the **tenant** (portal: `POST /api/tenantdashboard/handover-schedule`) or **operator** (`POST /api/tenancysetting/update` with `handoverCheckinAt` / `handoverCheckoutAt`) changes the scheduled time in `handover_*_json.scheduledAt`, a row is appended to **`tenancy_handover_schedule_log`**.

- Migration: `src/db/migrations/0143_tenancy_handover_schedule_log.sql`
- Service: `src/modules/tenancysetting/handover-schedule-log.service.js`
- Operator list: `POST /api/tenancysetting/handover-schedule-log` body `{ email, tenancyId, limit? }` → `{ ok, items[] }`

Fields: `field_name` (`checkin` | `checkout`), `old_value`, `new_value`, `actor_email`, `actor_type` (`tenant` | `operator`).

Run migration on ECS DB before relying on logs.

## Tenant-only: working hours window

**Tenant** `POST /api/tenantdashboard/handover-schedule` validates each updated `scheduledAt` so the **time of day** falls in **`admin.handoverWorkingHour`** only (not general `workingHour`). If handover start/end are both unset, defaults `10:00`–`19:00` (same as company settings form). Returns `403` with `reason: HANDOVER_OUTSIDE_WORKING_HOURS` and `message` / `window` when invalid.

**Operator** `POST /api/tenancysetting/update` does **not** apply this check (special cases).

Helpers: `src/modules/tenancysetting/handover-schedule-window.js`. Tenant init tenancies include `handoverScheduleWindow: { start, end, source }` for UI hints.
