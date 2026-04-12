# Cleaning SaaS Module

This folder is the product-domain boundary for Cleaning SaaS.

## Scope

- Product-specific business logic for cleaning operations
- Keep shared capabilities in existing shared modules (auth, access, accounting wrappers, payment wrappers)
- Use MySQL `_id` foreign keys only

## Suggested submodules

- `booking/` - create jobs, assign schedule windows
- `jobs/` - job lifecycle and status transitions
- `staff/` - cleaner profiles, capacity, availability
- `pricing/` - service package and quotation rules
- `invoice/` - billing projection for completed jobs
- `routes/` - HTTP route adapters for Cleaning APIs

## First milestone (MVP)

1. Create cleaning job
2. Assign cleaner
3. Mark complete
4. Generate billable line item
