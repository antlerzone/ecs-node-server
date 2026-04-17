# Profile gate — mandatory fields & migration notes

Portal gate logic (Next.js contexts) requires the fields below. This doc maps them to **where data should live in MySQL** so imports/backfills know which columns or JSON keys to populate.

## 1) Operator — Company Settings (`companyProfileComplete`)

| Mandatory (product) | Typical storage |
|---------------------|-----------------|
| Subdomain | `client_profile.subdomain` (also mirrored on `clientdetail.subdomain` when set) |
| Company name | `clientdetail.title` |
| Contact (mobile) | `client_profile.contact` |
| Address | `client_profile.address` |
| Bank name | `client_profile.bank_id` → `bankdetail.id` |
| Bank account | `client_profile.accountnumber` |
| Bank holder | `client_profile.accountholder` |

Optional for other flows (not required by current company gate): SSM/UEN/TIN, company logo, etc.

## 2) Operator — My Profile (`personalProfileComplete`)

| Mandatory (product) | Typical storage |
|---------------------|-----------------|
| Legal name | `client_user.name` (staff display name; shown as “Full name” on My Profile) |
| Entity type | `portal_account.entity_type` |
| ID type | `portal_account.id_type` or `portal_account.reg_no_type` |
| NRIC no | `portal_account.nric` (or align with `portal_account.tax_id_no` if you store ID there) |
| Phone | `portal_account.phone` |
| Address | `portal_account.address` |
| NRIC front / back | `portal_account.nricfront`, `portal_account.nricback` |
| Bank name | `portal_account.bankname_id` → `bankdetail.id` |
| Bank account / holder | `portal_account.bankaccount`, `portal_account.accountholder` |

**Exempted person:** if `entity_type = EXEMPTED_PERSON`, NRIC + document images are not required for the gate (ID type still required).

## 3) Tenant — My Profile (`profileComplete`)

| Mandatory (product) | Typical storage |
|---------------------|-----------------|
| Legal name | `tenantdetail.fullname` |
| Entity type | `tenantdetail.profile` JSON → `entity_type` |
| ID type | `tenantdetail.profile` JSON → `reg_no_type` or `id_type` |
| NRIC no | `tenantdetail.nric` |
| Phone | `tenantdetail.phone` |
| Address | `tenantdetail.address` (or `profile.address` if you move to JSON-only) |
| NRIC front / back | `tenantdetail.nricfront`, `tenantdetail.nricback` |
| Bank name | `tenantdetail.bankname_id` → `bankdetail.id` |
| Bank account / holder | `tenantdetail.bankaccount`, `tenantdetail.accountholder` |

**Exempted person:** same rule as operator personal — skip NRIC + images when `entity_type = EXEMPTED_PERSON`.

## 4) Owner — My Profile (`profileComplete`)

| Mandatory (product) | Typical storage |
|---------------------|-----------------|
| Legal name | `ownerdetail.ownername` |
| Entity type | `ownerdetail.profile` JSON → `entity_type` |
| ID type | `ownerdetail.profile` JSON → `reg_no_type` or `id_type` |
| NRIC no | `ownerdetail.nric` |
| Phone | `ownerdetail.mobilenumber` |
| Address | `ownerdetail.profile` JSON → `address` (object with `street`, `city`, …) |
| NRIC front / back | `ownerdetail.nricfront`, `ownerdetail.nricback` |
| Bank name | `ownerdetail.bankname_id` → `bankdetail.id` |
| Bank account / holder | `ownerdetail.bankaccount`, `ownerdetail.accountholder` |

## Extended migration / parity fields (tenant = owner = operator personal)

Gate treats **tenant = owner** the same (plus operator My Profile aligns on the same identity/KYC shape).  
Use these for **full parity** across person-like profiles (agreements, KYC, avatar):

| Field | Owner | Tenant | Operator (portal) |
|-------|--------|--------|-------------------|
| Legal name | `ownerdetail.ownername` | `tenantdetail.fullname` | `client_user.name` |
| Entity type | `ownerdetail.profile.entity_type` | `tenantdetail.profile.entity_type` | `portal_account.entity_type` |
| ID type | `ownerdetail.profile.reg_no_type` / `id_type` | same pattern | `portal_account.id_type` / `reg_no_type` |
| NRIC no | `ownerdetail.nric` | `tenantdetail.nric` | `portal_account.nric` |
| Tax ID no | `ownerdetail.profile.tax_id_no` | `tenantdetail.profile.tax_id_no` | `portal_account.tax_id_no` |
| Phone | `ownerdetail.mobilenumber` | `tenantdetail.phone` | `portal_account.phone` |
| Address | `ownerdetail.profile.address` | `tenantdetail.address` (+ optional JSON) | `portal_account.address` |
| NRIC front/back | `ownerdetail.nricfront/nricback` | `tenantdetail.nricfront/nricback` | `portal_account.nricfront/nricback` |
| Bank | `bankname_id` + account + holder | same | `bankname_id` + account + holder |
| Avatar | `ownerdetail.profile.avatar_url` | `tenantdetail.profile.avatar_url` | `portal_account.avatar_url` |

**Migration / import checklist (person-like profiles):**  
`entity_type`, `id_type` (or `reg_no_type`), `nric`, `phone` / `mobilenumber`, `address`, `nricfront`, `nricback`, `bankaccount`, `accountholder`, `bankname_id`, **`avatar_url`** (in profile JSON or `portal_account.avatar_url`), **`tax_id_no`** (profile JSON or `portal_account.tax_id_no`), plus **legal name** column per role (`ownername` / `fullname` / `client_user.name`).

If any column above is missing on a table, add it via a new migration **after** confirming with DB maintainers (do not assume column names).

## Code references

- Operator gate: `coliving/next-app/contexts/operator-context.tsx`
- Tenant gate: `coliving/next-app/contexts/tenant-context.tsx`
- Owner gate: `coliving/next-app/contexts/owner-context.tsx`
