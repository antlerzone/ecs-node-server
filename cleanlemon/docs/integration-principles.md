# Cleanlemons integration principles (canonical)

## 1) Coliving operator → Cleanlemons: one operator = one Cleanlemons client

When a **Coliving operator** integrates with **Cleanlemons**:

- **Each Coliving operator is a separate `client` in Cleanlemons** (not one shared Coliving umbrella client for all operators).
- **Each operator authorises with their own API secret key** (or equivalent credential). There is **no** single shared secret for “all Coliving operators”.

This is a hard product rule: isolation, billing, property mapping, and API scope are **per operator**.

## 2) Operator ↔ operator integration: out of scope for now

**Operators do not integrate with other operators** in the current phase.

Future cross-operator flows (if any) are explicitly **not** part of v1 and must be re-scoped later.

## Related docs

- [data-model-identity-property.md](./data-model-identity-property.md) — separate `property` / `owner` in Cleanlemons, Coliving junction, integration auth patterns
- [wix-legacy-migration-record.md](./wix-legacy-migration-record.md)
- [cleaning-mysql-table-estimate.md](./cleaning-mysql-table-estimate.md)
