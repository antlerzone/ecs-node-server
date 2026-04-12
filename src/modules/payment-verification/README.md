# Payment Verification Module

Implements the **SaaS Payment Verification** flow: receipt upload → AI OCR → bank transaction sync (Finverse) → matching engine → PAID or manual review.

- **DB**: `payment_invoice`, `payment_receipt`, `bank_transactions`, `payment_verification_event` (migration `0118_payment_verification_tables.sql`).
- **API**: Mounted at `/api/payment-verification` (apiAuth + apiClientScope). Client id from `req.client.id` or `req.body.client_id`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /receipts | Create invoice from receipt (receipt_url required; optional amount, currency, reference_number). Runs AI OCR. |
| GET | /invoices | List invoices (optional ?status=). |
| GET | /invoices/:id | Get invoice with receipt and candidate bank transactions. |
| POST | /invoices/:id/match | Run matching engine for this invoice. |
| POST | /invoices/:id/approve | Manual approve (optional body.bank_transaction_id). |
| POST | /invoices/:id/reject | Manual reject. |
| POST | /sync-bank | Sync bank transactions from Finverse (optional body.from_date, to_date). |

## AI Router

Operator config in `client_integration`: `key = 'aiProvider'`, `provider = 'gemini'|'openai'|'deepseek'`, `values_json.api_key`, `values_json.model`.  
Stub in `ai-router.service.js`: returns mock OCR; TODO integrate Gemini/OpenAI/DeepSeek vision APIs.

## Matching

`matching.service.js`: confidence from transaction_id, reference contains invoice number, amount, date ±24h, payer name.  
> 90% → PAID; 60–90% → PENDING_REVIEW; < 60% → leave PENDING_VERIFICATION.

## Finverse

Operator must have linked bank (Finverse) and `finverse_login_identity_token` in `client_integration` (bankData/finverse) for `/sync-bank` to work.

See `docs/saas-payment-verification-payout-prompt.md` for full spec.
