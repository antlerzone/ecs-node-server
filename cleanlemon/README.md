# Cleanlemon Workspace

This folder is isolated for the Cleanlemon product line.

## Purpose

- Import and develop a standalone Next.js app for Cleanlemon
- Keep changes isolated from existing Coliving code paths

## Foldering

- `next-app/` - place your imported Next.js project here
- `docs/` - Cleanlemon-specific notes and rollout docs

## Isolation rule

- Do not modify Coliving Next app files for Cleanlemon features
- Do not reuse Coliving routes directly without an adapter layer

## Product spec (chat record, execute later)

- [docs/session-spec-cleanlemons-2026-03-26.md](./docs/session-spec-cleanlemons-2026-03-26.md) — domains, OSS, property/owner/operator flows, integration scope.
- [docs/data-model-identity-property.md](./docs/data-model-identity-property.md) — separate property/owner tables, Coliving junction, login-Allow vs paste-secret.
- [docs/index.md](./docs/index.md) — docs navigation + auth/profile rules (operator as staff, create/change password behavior).

## Production deploy（避免 chunk / 静态资源错误）

- 一键：`/home/ecs-user/app/scripts/deploy-cleanlemons-portal.sh`（或根目录 `npm run deploy:cleanlemons-portal`）。
- 原因与检查清单：**[docs/portal-chunk-prevention.md](./docs/portal-chunk-prevention.md)**。

## Current implementation notes (Phase 1)

- **Country scope:** Cleanlemons currently supports **Malaysia only** in Company Profile.
- **Company page:** `next-app/app/portal/operator/company/page.tsx` (route: `/operator/company`)
  - Integration UI follows Coliving behavior: **single category card** for Payment and Accounting, not per-provider cards.
  - **Payment gateway:** only one provider can be connected at a time (Stripe or Xendit).
  - **Accounting:** only one provider can be connected at a time (Bukku or Xero).
  - **Connect flow:** click category `Connect` -> provider selection dialog -> confirm connect.
  - **AI Agent flow:** two dialogs:
    1) choose provider (`OpenAI` / `DeepSeek` / `Gemini`)
    2) enter API key and connect.
- **Billing behavior (operator):**
  - Cleanlemons is **direct pay** (no SaaS admin contact flow on this page).
  - Add-on cycle follows subscription cycle:
    - monthly plan -> add-on billed monthly
    - yearly plan -> add-on billed yearly

## Integration (Coliving ↔ Cleanlemons)

Canonical rules: [docs/integration-principles.md](./docs/integration-principles.md)

- **One Coliving operator = one Cleanlemons client**, each with **its own secret key**.
- **No operator-to-operator integration** in the current phase.
