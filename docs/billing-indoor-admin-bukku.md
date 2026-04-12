# SaaS Indoor Admin：手動 Topup / Renew + 平台 Bukku Cash Invoice

## Stripe Topup 支付成功後開 Invoice 給 Operator（已接好）

- **場景**：Operator 在 Portal Credit 頁或 Wix 各頁點 Top-up → 跳 Stripe 支付給**平台**；支付完成後，**平台**用自家 Bukku 開一張 cash invoice **給該 operator（client）**，並把 invoice URL 寫回 `creditlogs.invoiceid` / `creditlogs.invoiceurl`，Operator 在流水裡可點 **Invoice** 查看。
- **Hook**：Stripe Webhook `checkout.session.completed`，當 `metadata.type === 'Topup'` 時（見 `src/modules/stripe/stripe.service.js`）：
  1. 更新該筆 creditlog 為已付（`is_paid=1`、`paiddate` 等）、給 client 加 credit；
  2. 取 contact：`ensureClientBukkuContact(client_id)`（用 `clientdetail.bukku_saas_contact_id`，無則在平台 Bukku 建 contact 並回寫）或 fallback `BUKKU_SAAS_DEFAULT_CONTACT_ID`；
  3. 調用 `createSaasBukkuCashInvoiceIfConfigured` 開單（product=16 topup、account=70、payment=71 Stripe）；
  4. 若開單成功，`UPDATE creditlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?`。
- **Env**：與下方「Node 環境變數」相同。若 **未配置** `BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`，或沒有 contact（且無 `BUKKU_SAAS_DEFAULT_CONTACT_ID`），則**不開單、不報錯**，僅該筆流水無 Invoice 按鈕。

## Operator as customer（與 booking 頁類似）

開單前會先把 **operator（client）** 在平台 Bukku 當成 customer：

1. 用 **clientdetail** 的 `email` + `title`（name）在 env 設定的 **SaaS platform Bukku** 先 **search** contact。
2. **有則**：取回 contact id，寫入 `clientdetail.bukku_saas_contact_id`（mydb）。
3. **沒有則**：在 Bukku **create** operator as customer，取回 id，寫入 `clientdetail.bukku_saas_contact_id`。
4. 然後用該 contact 開 **cash invoice**。

實作：`ensureClientBukkuContact(clientId)`（`src/modules/billing/saas-bukku.service.js`），manual topup / manual renew 都會先呼叫此函數再開單。

## 檢查 env 是否已有 API Key & Subdomain

- **API**：`POST /api/billing/indoor-admin/saas-bukku-status`（Body 需帶 `email`，需 admin 權限）。
- **回傳**：`{ ok: true, configured: boolean, hasApiKey: boolean, hasSubdomain: boolean, message }`。
  - `configured === true` 表示可開單；`false` 表示需在 .env 設定 `BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN` 並**重啟**。

## 修改 .env 後需重啟

改動 `.env` 後，Node 不會自動重載，需重啟進程新值才會生效。你可自行執行：

```bash
# 若用 pm2
pm2 restart app

# 或指定 name
pm2 restart all

# 若用 npm run dev（nodemon 會自動重載，通常不用手動重啟）
npm run dev
```

若在 ECS/系統服務裡跑的是 `node server.js`，重啟方式依部署而定（例如 systemctl restart your-service 或重新 deploy）。

## 流程（Indoor 手動 Topup / Renew）

1. SaaS admin 在 [SaaS Admin](https://portal.colivingjb.com/saas-admin) 選擇 client、填寫 amount（topup）或 plan + paidDate，點擊提交。
2. **Create new customer / 建立新 plan 時**：後端會用該 client 的 email / legal name（title）在平台 Bukku 先查 contact；有則取 id 寫回 `clientdetail.bukku_saas_contact_id`，無則新建 contact 並寫回，然後用該 contact 開 **pricing plan invoice**（product=15, account=70, payment=3）。回應會帶 `bukku_saas_contact_id`、`invoiceUrl`。
3. **Operator topup credit 時**：同樣先 ensure contact（查/建），再開 **topup invoice**（product=16, account=70, payment=3）。回應會帶 `bukku_saas_contact_id`、`invoiceUrl`。
4. 可選：前端在提交前可先呼叫 `POST /api/billing/indoor-admin/ensure-bukku-contact`（Body: `{ email, clientId }`）取得 `bukku_saas_contact_id`，再呼叫 manual-renew 或 manual-topup。
5. API：
   - `POST /api/billing/indoor-admin/ensure-bukku-contact` — Body: `{ email, clientId }`，回傳 `{ ok, bukku_saas_contact_id }`
   - `POST /api/billing/indoor-admin/manual-topup` — Body: `{ email, clientId, amount, paidDate }`，回傳含 `bukku_saas_contact_id`、`invoiceUrl`
   - `POST /api/billing/indoor-admin/manual-renew` — Body: `{ email, clientId, planId, paidDate }`，回傳含 `bukku_saas_contact_id`、`invoiceUrl`
6. 收款科目：indoor 人為操作一律用 **Bank = 3**。

## Migrations（如需）

- **0069**：`clientdetail.bukku_saas_contact_id`（存平台 Bukku contact id）。若尚未執行：  
  `node scripts/run-migration.js src/db/migrations/0069_clientdetail_bukku_saas_contact_id.sql`
- **0112**：`creditlogs.pricingplanlog_id`、`sourplan_id`（manual-renew 寫 creditlogs 時需要）。若出現 `Unknown column 'pricingplanlog_id'`：  
  `node scripts/run-migration.js src/db/migrations/0112_creditlogs_pricingplanlog_sourplan_if_missing.sql`

## 平台 Bukku 憑證（Secret Manager）

僅用於 topup credit 與 pricing plan 的 indoor 開單，與各 client 的 addonAccount Bukku 無關。

| Secret 名稱 | 說明 |
|-------------|------|
| `bukkuApiKey` 或 `#bukkuApiKey` | 平台 Bukku API Key（對應 Node env：BUKKU_SAAS_API_KEY） |
| `bukkusubdomain` | 平台 Bukku 子網域（對應 Node env：BUKKU_SAAS_SUBDOMAIN） |

在 ECS 上由 Secret Manager 注入為環境變數即可，例如：  
`BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`。

## 誰需要設定 BUKKU 變數？只給 Node API，Next 不用

- **開 Bukku 單的是 Node API**（`server.js`），不是 Next。Next 只負責：瀏覽器 → `/api/portal/proxy` → 轉發到 **api.colivingjb.com**（或同機 `127.0.0.1:5000`）。
- 因此 **`BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN` 只需寫在「跑 Node API 那台機器的 .env」**（即 `server.js` 所在專案根目錄的 `.env`）。改動後要 **重啟 Node 進程**（如 `pm2 restart app`）。
- **Next（Portal）不需要、也不該放** 這兩個變數；Next 只透過 proxy 呼叫 api.colivingjb.com，真正打 Bukku API 的是 Node。

## Node 環境變數（可選覆寫預設）

| 變數 | 預設 | 說明 |
|------|------|------|
| BUKKU_SAAS_API_KEY | — | 必填，平台 Bukku API Key |
| BUKKU_SAAS_SUBDOMAIN | — | 必填，平台 Bukku 子網域 |
| BUKKU_SAAS_DEFAULT_CONTACT_ID | — | 可選。有 operator-as-customer 流程（search/create 每戶 contact）時不需設；僅在該 client 無法取得 contact 時當 fallback 用 |
| BUKKU_SAAS_PRODUCT_PRICINGPLAN | 15 | 產品 id：pricing plan |
| BUKKU_SAAS_PRODUCT_TOPUPCREDIT | 16 | 產品 id：topup credit |
| BUKKU_SAAS_ACCOUNT | 70 | 收入科目 |
| BUKKU_SAAS_PAYMENT_BANK | 3 | 收款科目（manual） |
| BUKKU_SAAS_PAYMENT_STRIPE | 71 | 收款科目（Stripe，目前 indoor 未用） |

## 前端改法（Saas-indoor-admin）

將原本：

```js
import { manualRenew } from 'backend/billing/manualrenew';
import { manualTopup } from 'backend/billing/manualtopup';
```

改為：

```js
import { manualRenew, manualTopup } from 'backend/saas/indooradmin';
```

呼叫方式不變：`manualTopup({ clientId, amount, paidDate })`、`manualRenew({ clientId, planId, paidDate })`。  
JSW 實作見 `docs/wix/jsw/velo-backend-saas-indooradmin.jsw.snippet.js`，需部署為 `backend/saas/indooradmin.jsw`。

## Manual Billing 頁（開戶／續費同一頁）

同一頁用於 **demo 後開戶** 與 **續費**：客戶列表與方案從 ECS 取得，不讀 Wix CMS。

- **JSW：** `backend/saas/manualbilling.jsw`（源碼 `docs/wix/jsw/velo-backend-saas-manualbilling.jsw.snippet.js`）
  - `getClients()` → `POST /api/billing/indoor-admin/clients`，回傳 `{ items }`，每筆含 `id, title, email, hasPlan`
  - `getPlans()` → `POST /api/billing/plans`，回傳方案陣列（sellingprice 由低到高）
  - `manualTopup({ clientId, amount, paidDate })`、`manualRenew({ clientId, planId, paidDate })` 同 indoor-admin
- **前端：** `docs/wix/frontend/manual-billing-page-full.js`
  - `#dropdownclient` 選 client 時，依該 client 的 `hasPlan` 設定 `#buttonsubmitpricingplan` 的 label 為 **Renew** 或 **Create**
  - `#datepicker1` = 顧客支付日期（pricing plan）；`#datepicker2` = topup 支付日期
  - 不再使用 `wix-data`；`initClients` / `initPricingPlans` 改為呼叫上述 JSW

Node 新增：`POST /api/billing/indoor-admin/clients`（需 admin 或 billing），回傳所有 client 及 `hasPlan`（依 `pricingplandetail` 是否含 type=plan）。

## 權限

兩支 API 皆需 **admin 或 billing** 權限（依 `getAccessContextByEmail(email)` 的 staff permission 判斷）。`/indoor-admin/clients` 與 `/indoor-admin/manual-topup`、`/indoor-admin/manual-renew` 相同。
