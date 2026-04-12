# Payout Module (Bulk Transfer / Bulk Payout)

Stub for operator-initiated **bulk payouts** via Finverse Payments API (Collect API).

## Intended flow

1. Operator connects bank via Finverse (existing `finverse` module).
2. Operator creates a **payout batch** (e.g. payroll, vendor payouts).
3. SaaS payout engine calls Finverse Payments API to execute individual transfers.
4. Webhook or poll updates batch and item status.

## DB (to be added)

- **payout_batch**: id, client_id, status, total_amount, currency, finverse_batch_id, created_at, updated_at.
- **payout_item**: id, payout_batch_id, amount, recipient_name, recipient_account, status, finverse_transfer_id, created_at, updated_at.

## Implementation status

- **Stub only.** Implement when Finverse Collect/Payments API integration is required.
- Ref: [Finverse Payments API](https://www.finverse.com/payments-api), repo root `docs/saas-payment-verification-payout-prompt.md`.
