# Terms & Conditions (SaaS–Operator)

Operator must sign the platform Terms & Conditions. Signature and hash are stored for audit and non-repudiation.

## Flow

1. **Content**: T&C text is in `docs/terms/saas-operator-terms-v1.md`. Backend reads it and computes `content_hash = SHA256(content)`.
2. **Get terms**: `POST /api/terms/saas-operator` (body: `{ email }`) → returns `content`, `version`, `contentHash`, `accepted`, `acceptedAt`, `signatureHash`.
3. **Sign**: `POST /api/terms/saas-operator/sign` (body: `{ email, signature }`) → stores signature, IP, and `signature_hash = SHA256(acceptanceId | signature | signed_at_iso | content_hash)`.

## DB

- Table: `terms_acceptance` (migration `0102_terms_acceptance.sql`).
- One row per `(client_id, document_type)`; re-signing updates the same row.
- Columns: `id`, `client_id`, `document_type`, `version`, `content_hash`, `signature`, `signed_at`, `signed_ip`, `signature_hash`.

## Frontend

- Operator portal: **Terms & Conditions** under System in sidebar → `/operator/terms`.
- Page shows T&C content, signature input, and Sign button; after signing, shows accepted state and stored `signature_hash`.

## Legal

The T&C text limits SaaS liability, disclaims warranties, requires operator indemnification, and reserves maximum discretion (suspend/terminate access, change terms). Governing law: Malaysia. For production, have a lawyer review `saas-operator-terms-v1.md`.
