# Finverse module (Bank Data API wrapper)

Per-operator Finverse integration for the **AI-powered SaaS Payment Verification Platform**: each operator connects their own bank data via Finverse; the backend uses it for payment matching (receipt OCR + bank transactions).

Ref: [Finverse API Docs](https://docs.finverse.com), [Data API](https://www.finverse.com/bank-data-api).

## Flow (summary)

1. **Operator config** – Store `client_id`, `client_secret`, `redirect_uri` in `client_integration` (key=`bankData`, provider=`finverse`) or in env (`FINVERSE_CLIENT_ID`, `FINVERSE_CLIENT_SECRET`, `FINVERSE_REDIRECT_URI`).
2. **Customer access token** – Backend uses client_credentials to get a customer token (cached).
3. **Link bank** – Backend gets a link token → returns `link_url` → user opens Finverse Link UI and links their bank.
4. **Login identity token** – After redirect with `code`, backend exchanges it for a **login identity access token**.
5. **Data** – Use that token to call `getLoginIdentity`, `listAccounts`, `listTransactions` for payment verification.

## Usage

```js
const finverse = require('./src/modules/finverse');

// 1) Get link URL for operator to connect bank
const { link_url } = await finverse.auth.generateLinkToken(clientId, {
  user_id: operatorUserId,
  redirect_uri: 'https://yourapp.com/finverse/callback',
  state: 'unique-state'
});

// 2) After user completes Link, exchange code (from callback)
const { access_token } = await finverse.auth.exchangeCodeForLoginIdentity(clientId, {
  code: queryOrBody.code,
  redirect_uri: 'https://yourapp.com/finverse/callback'
});
// Store access_token per operator (e.g. client_integration.values_json.finverse_login_identity_token).

// 3) Fetch transactions for payment matching
const { transactions } = await finverse.bankData.listTransactions(access_token, {
  from_date: '2025-01-01',
  to_date: '2025-01-31',
  limit: 100
});
```

## Env

| Variable | Description |
|----------|-------------|
| `FINVERSE_BASE_URL` | Override base (default: `https://api.prod.finverse.net`) |
| (default) | All calls use production; test vs live is by app type in Developer Portal |
| `FINVERSE_CLIENT_ID` / `FINVERSE_CLIENT_SECRET` / `FINVERSE_REDIRECT_URI` | Fallback when client has no integration row |

## DB

- **client_integration**: `key = 'bankData'`, `provider = 'finverse'`, `values_json` e.g.:
  - `finverse_client_id`, `finverse_client_secret`, `finverse_redirect_uri`
  - Optionally `finverse_login_identity_token` (after link) – store encrypted if needed.

## API paths

Paths used in this wrapper (`/auth/customer/token`, `/customer/link_tokens`, `/link/token`, `/login_identities/me`, `/accounts`, `/transactions`) follow [docs.finverse.com](https://docs.finverse.com); **verify against [docs.finverse.com](https://docs.finverse.com)** and set `FINVERSE_BASE_URL` or adjust `wrappers/finverseRequest.js` and the wrappers if the API uses different paths or versions (e.g. `/v1/...`).

## Payment verification

Use **bankData.listTransactions** together with your **AI receipt OCR** and **matching engine** (amount, reference, date ±24h, payer name) to mark invoices as PAID when confidence &gt; 90%.
