# Cleanlemon Docs Index

## Product and Architecture

- `portal-chunk-prevention.md` - production deploy, dual-PM2, avoid ChunkLoadError / static 500.
- `session-spec-cleanlemons-2026-03-26.md` - product scope, domains, rollout notes.
- `data-model-identity-property.md` - identity and property model decisions.
- `integration-principles.md` - Coliving and Cleanlemon integration guardrails.

## Operator Company Page (Implemented)

- Page path: `next-app/app/portal/operator/company/page.tsx`
- Route: `/operator/company`

### Company Profile rules (Phase 1)

- Country is fixed to **Malaysia only**.
- Registration field uses **SSM Number** (no multi-country/UEN branch yet).
- Multi-country support is planned for a later phase.

### Integration rules (Coliving-style behavior)

- Payment and Accounting each use **one category card** with a category-level `Connect` button.
- Provider is chosen in a dialog (not directly from card buttons).
- Connection constraints:
  - Payment: **Stripe or Xendit**, only one active provider.
  - Accounting: **Bukku or Xero**, only one active provider.
- AI Agent uses a **2-step dialog flow**:
  1) choose provider: `OpenAI` / `DeepSeek` / `Gemini`
  2) enter API key and connect.

### Subscription and Add-on behavior

- Cleanlemons operator flow is **direct payment** (no "contact SaaS admin" flow here).
- Add-on billing follows selected plan cycle:
  - monthly plan -> add-on monthly
  - yearly plan -> add-on yearly.

## Auth and Profile Rules

- Operator account is treated as a staff profile in contact management.
- For security UI:
  - If user has password (`hasPassword=true`), show `Change Password`.
  - If social login user has no password (`hasPassword=false`), show `Create Password`.
  - Password create/change flow should require email OTP verification in backend.
