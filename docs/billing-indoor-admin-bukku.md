# SaaS Indoor Admin：手動 Topup / Renew + 平台 Bukku Cash Invoice

## 流程

1. SaaS admin 在 indoor admin 前端選擇 client、填寫 amount（topup）或 plan + paidDate，點擊提交。
2. 前端呼叫 `backend/saas/indooradmin.jsw` 的 `manualTopup` / `manualRenew`，JSW 再請求 ECS Node：
   - `POST /api/billing/indoor-admin/manual-topup` — Body: `{ email, clientId, amount, paidDate }`
   - `POST /api/billing/indoor-admin/manual-renew` — Body: `{ email, clientId, planId, paidDate }`
3. Node：先寫入 DB（creditlogs / pricingplanlogs + 更新 client credit 或 plan），成功後再以**平台自家 Bukku** 開一筆 **cash invoice**（即開即收）。
4. 收款科目：indoor 人為操作一律用 **Bank = 3**；若日後有「低於 1000 走 Stripe」的 indoor 場景再改用 71。

## 平台 Bukku 憑證（Secret Manager）

僅用於 topup credit 與 pricing plan 的 indoor 開單，與各 client 的 addonAccount Bukku 無關。

| Secret 名稱 | 說明 |
|-------------|------|
| `bukkuApiKey` 或 `#bukkuApiKey` | 平台 Bukku API Key（對應 Node env：BUKKU_SAAS_API_KEY） |
| `bukkusubdomain` | 平台 Bukku 子網域（對應 Node env：BUKKU_SAAS_SUBDOMAIN） |

在 ECS 上由 Secret Manager 注入為環境變數即可，例如：  
`BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`。

## Node 環境變數（可選覆寫預設）

| 變數 | 預設 | 說明 |
|------|------|------|
| BUKKU_SAAS_API_KEY | — | 必填，平台 Bukku API Key |
| BUKKU_SAAS_SUBDOMAIN | — | 必填，平台 Bukku 子網域 |
| BUKKU_SAAS_DEFAULT_CONTACT_ID | — | 必填，開 cash invoice 用的 contact_id（客戶/公司） |
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
