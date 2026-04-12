# Cleanlemon Wix Legacy Migration Record

## Source snapshot

The following legacy Wix frontend code blocks were provided by the project owner and archived for migration planning:

- Supervisor frontend (menu sections, scheduling, linens, agreement, salary, property setting)
- Staff frontend (attendance, daily task lifecycle, damage report, salary signoff, agreement signing)
- Client frontend (dashboard, new task, record, damage, finance, property setting, create property)

This record is intentionally high-level so the migration work can reference one canonical source note.

## Legacy functional domains identified

1. Supervisor domain
   - Daily operations dashboard
   - Linen calculation
   - Task update and status changes
   - Meeting agenda
   - Release salary / part-time salary
   - Property setting and create property
   - Staff agreement workflow
2. Staff domain
   - Attendance in/out with geolocation and selfie
   - Daily cleaning task start/end
   - Damage report upload
   - KPI view and logs
   - Payslip sign
   - Offer letter agreement signing
3. Client domain
   - Task submission
   - Schedule dashboard and task status view
   - Job record and finance
   - Damage report view
   - Property setting and create property
   - Feedback submission

## Migration constraints

- Cleanlemon work must remain isolated from Coliving modules.
- New APIs should use dedicated Cleanlemon namespace.
- FK convention follows project rule: use `_id` references only.

## Immediate next action

- Keep this file as baseline source record for planning and implementation checkpoints.
