# Google Drive OAuth (operator storage for agreement PDFs)

Operators can connect **their own Google account** in **Company Settings → System Integrations → Storage → Google Connect**. Agreement PDF generation (Docs + Drive API) then uses that account’s quota instead of the platform service account.

## GCP / Google Cloud Console

1. Create an **OAuth 2.0 Client ID** (type **Web application**).
2. Add **Authorized redirect URIs** (must match exactly):
   - Production: `https://<your-api-host>/api/companysetting/google-drive/oauth-callback`
   - Or set `GOOGLE_DRIVE_OAUTH_REDIRECT_URI` to the full callback URL you register.
3. Enable APIs for the project: **Google Drive API**, **Google Docs API**, **People API** (if needed), **Google+** / **People** — minimally **Drive** + **Docs**.

## ECS / Node `.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID` | No* | Web client ID from GCP. *If omitted, **`GOOGLE_CLIENT_ID`** (portal Google login) is used — same OAuth client is fine. |
| `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | No* | Web client secret. *If omitted, **`GOOGLE_CLIENT_SECRET`** is used. |
| `GOOGLE_DRIVE_OAUTH_TOKEN_SECRET` | **Yes** | Long random string; encrypts refresh tokens in MySQL (do **not** reuse the OAuth client secret). |
| `GOOGLE_DRIVE_OAUTH_REDIRECT_URI` | No | Full callback URL. If unset, built as `{API_BASE_URL or PUBLIC_APP_URL}/api/companysetting/google-drive/oauth-callback`. |
| `GOOGLE_DRIVE_OAUTH_STATE_SECRET` | No | HMAC secret for OAuth `state`. Defaults to `GOOGLE_DRIVE_OAUTH_TOKEN_SECRET`. |
| `API_BASE_URL` or `PUBLIC_APP_URL` | If no redirect URI | Used only to derive default callback URL. |
| `PORTAL_APP_URL` | Recommended | Used to redirect users back to `{PORTAL}/operator/company` after OAuth. |

## Data model

- Table: `client_integration`
- `key` = `storage`, `provider` = `google_drive`, `enabled` = 1 when connected.
- `values_json`: `{ refresh_token_enc, google_email }` (token encrypted; never log).

## Operator checklist

- Connect via **Google Connect** on Company Settings.
- In Google Drive, **share** the agreement **template Doc** and the **output folder** with the same Google account (Editor or Content manager as needed).
- If Google returns `no_refresh_token`, revoke the app under Google Account → Security → Third-party access and connect again (consent screen must issue a refresh token).

## Platform service account

If no operator OAuth row exists, PDF generation still uses `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` when set (existing behaviour).
