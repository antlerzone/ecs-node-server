# Cleaning SaaS MVP Foldering

This document defines the initial foldering for the Cleaning SaaS product domain.

## Why this structure

- Keep cleaning logic isolated from coliving-specific modules
- Reuse shared platform capabilities (auth, access, payments, accounting wrappers)
- Reduce future migration risk when splitting products into separate portals/domains

## Implemented foldering

Under `src/modules/cleaning/`:

- `booking/` - create and schedule cleaning jobs
- `jobs/` - status lifecycle (pending, assigned, in_progress, completed, cancelled)
- `staff/` - cleaner assignment and availability
- `pricing/` - package and quote rules
- `invoice/` - billable item generation hooks
- `routes/` - API route handlers for cleaning domain

## MVP boundary (recommended)

1. Job create
2. Cleaner assign
3. Job complete
4. Billable record create

## Integration notes

- Keep FK usage `_id` only
- Use existing access/auth middleware
- Use existing billing/accounting wrappers for money flow
- Add cleaning-specific tables in new migrations when schema is confirmed
