# Cleanlemons — session spec (record for later execution)

**Status:** planning record only — **do not treat as implemented** until migrations and code land.

**Date:** 2026-03-26

---

## 1. Domains and frontend

| Site | Backend |
|------|---------|
| **demo.cleanlemons.com** | **No** connection to Cleanlemons Node API (demo / static / mock only). |
| **portal.cleanlemons.com** | **Yes** — connects to backend (e.g. api.cleanlemons.com). |

DNS example (user): `portal`, `demo`, `api` → same IP; behaviour is **by app config**, not DNS alone.

---

## 2. File upload (OSS)

- All uploads use **Aliyun OSS**.
- Object key / prefix must be **namespaced for Cleanlemons** (foldering), distinct from Coliving paths, e.g. `cleanlemons/{...}`.

---

## 3. Coliving vs Cleanlemons (product relationship)

- **Coliving SaaS** is **one possible source** of operators/properties, not the only one (webhooks, other software, native Cleanlemons clients).
- **Cleanlemons has its own property (and owner) tables**; external systems link via **junction / external_id**. See [data-model-identity-property.md](./data-model-identity-property.md).
- Integrated Coliving (per operator) should be able to call API for e.g. **create job**, **create/sync property**, **cancel job**, **invoice & payment** integration — exact endpoints TBD.
- **Authorisation UX:** (A) same-email login to Cleanlemons + Allow, plus server-issued secret; or (B) copy secret from Cleanlemons Settings into Coliving — both documented in that file.

---

## 4. Property creation and ownership (Cleanlemons product rules)

1. **Cleanlemons** can **create property**, then **approval** flow to decide **which operator** receives / manages it.
2. **Operator** can **create property** and **link owner**; **both** sides may create; **ownership is shared** in the product sense — **both can edit** (subject to roles and approval states).
3. Same spirit as Coliving SaaS: **one client** can have **many properties** and **many operators**.
4. **One property** can be assigned to **different operators** (multi-operator), with explicit access rules.

### 4.1 Access / approval flows (as described)

**A. Owner → Operator**

1. **Owner approves** operator access to **selected properties**.
2. After approval, operator has agreed scope (e.g. “full access to selected property” — exact permission matrix TBD).

**B. Operator → Owner**

1. **Operator creates property** and sends to **owner approval**.
2. Owner **accepts** → property is **mapped** to that operator.
3. Expectation: **bidirectional sync** of property data/state between owner and operator views (implementation TBD).

---

## 5. Integration principles (hard rules)

Documented in detail: [integration-principles.md](./integration-principles.md)

- **Each Coliving operator = separate Cleanlemons `client`**.
- **Each operator uses its own secret key** (no single shared key for all Coliving operators).
- **No operator ↔ operator integration** in the current phase.

---

## 6. Legacy Wix / migration context

- Wix supervisor / staff / client page logic and CSV imports are **legacy inputs**; see [wix-legacy-migration-record.md](./wix-legacy-migration-record.md).
- MySQL table draft estimate (early): [cleaning-mysql-table-estimate.md](./cleaning-mysql-table-estimate.md).

---

## 7. Next step (this thread)

- Align on **MySQL tables** (names, FKs with `_id`, junction tables for owner–operator–property, API client keys per operator, jobs, invoices, etc.) before writing migrations.
- **Data model decisions:** [data-model-identity-property.md](./data-model-identity-property.md)
