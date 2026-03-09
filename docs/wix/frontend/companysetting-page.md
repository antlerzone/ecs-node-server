# Company Setting 页面迁移说明（ECS + 无 #boxintegration / #repeaterintegration）

- **完整前端代码：** [companysetting-page-full.js](./companysetting-page-full.js) — 可直接粘贴到 Wix 页面代码，按需调整元素 ID。
- **JSW（粘贴到 Wix 后台 backend/saas/companysetting.jsw）：** [../jsw/companysetting.jsw](../jsw/companysetting.jsw)。
- **数据来源：** 全部走 ECS，通过 `backend/saas/companysetting` JSW 调用 `/api/companysetting/*`，不再使用 `wixData`。
- **Billing / Topup：** 仍使用 `backend/saas/billing`（`getMyBillingInfo`、`startNormalTopup` 等）。
- **移除 UI：** 不再使用 `#boxintegration`、`#repeaterintegration`；集成改为各 onboard 按钮直接连对应服务并写 MySQL（见下）。
- **Stripe：** 当前环境使用 **Sandbox**（`.env` 中 `STRIPE_SECRET_KEY=sk_test_...`、前端如需 publishable 用 `pk_test_...`）。上线再切 Live。

## 1. Import 与入口

```javascript
import wixLocation from 'wix-location';
import { getAccessContext } from 'backend/saas/companysetting';
import { getMyStaffList, createStaff, updateStaff } from 'backend/saas/companysetting';
import { getIntegrationTemplate } from 'backend/saas/companysetting';
import { getProfile, updateProfile } from 'backend/saas/companysetting';
import { getBanks } from 'backend/saas/companysetting';
import { getAdmin, saveAdmin } from 'backend/saas/companysetting';
import { getStripeConnectOnboardUrl, cnyiotConnect, bukkuConnect, getXeroAuthUrl, xeroConnect, ttlockConnect } from 'backend/saas/companysetting';
import { getMyBillingInfo, startNormalTopup } from 'backend/saas/billing';
```

- 不再 `import wixData`，不再 `import ... from 'backend/query/staffdetail'` / `backend/tenancy/contact'` / `'backend/integration/integrationtemplate'`。

## 2. 初始化与权限（与现有一致）

- `startInitAsync()` 内用 `getAccessContext()` 取 `accessCtx`、`currentClientId`、`clientCurrency`。
- 权限不足或无 client 时 `showAccessDenied(...)`；`applyUIPermissions(accessCtx.staff.permission)`。
- **不再** 绑定或显示 `#repeaterintegration`、`#boxintegration`；不调用 `initIntegrationSection()`（原依赖 wixData clientdetail + integration template 的那套）。

## 3. Profile 区块

- **加载：** 进入 profile 时 `getProfile()`，用返回的 `client`、`profile` 填表（title, currency, profilephoto, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bankId）。
- **银行下拉：** `getBanks()` → `items: [{ label, value }]` 填 `#dropdownbank`（公司收款银行，与 client_profile.bank_id 对应）。

### Bank 列表用在哪里

- **Profile 区块：** `#dropdownbank` — 公司资料里的「收款银行」，保存到 `client_profile.bank_id`（对应 `bankdetail.id`）。
- **User Setting 区块：** `#dropdownbanknameusersetting` — 编辑/新建员工时的「银行」下拉，保存到 `staffdetail.bank_name_id`（对应 `bankdetail.id`）。  
  两处都调用同一接口 `getBanks()`，无需登录校验（页面本身已门禁）。
- **保存：** 从表单收集字段后 `updateProfile({ title, currency, profilephoto?, companyChop?, ssm, address, contact, subdomain, tin, accountholder, accountnumber, bankId })`。
- 头像上传：仍用 Wix 上传拿到 URL，把 URL 传入 `updateProfile({ profilephoto: url })`。
- **#sectionprofile 上方：** 放 **#imagecompanychop**（Image 元素）。有 `profile.companyChop` URL 时显示、无则隐藏；加载 Profile 时根据该字段自动 show/hide。
- **#boxprofile 内：** 含 `#htmluploadbuttonprofile`（公司 logo/头像）、**#htmlcompanychop**（公司章上传，走 `/api/upload/chop`，自动白底）。可选 `#imagecompanychop` 用于编辑时预览；只读展示用 section 上方的 #imagecompanychop。上传 iframe 需支持 INIT 的 `uploadPath`、`makeBackgroundWhite`（见 `upload-oss-embed.html`）。

## 4. User Setting 区块（Admin 管理员工：permission + active/inactive）

- **用途：** Admin 决定谁有什么 permission、谁 active/inactive。**不是**员工编辑自己 profile；员工编辑自己用 sectionprofile（见下）。
- **列表：** `getStaffList()` → `items` 填 repeater，并返回 `mainAdminEmail`（clientdetail.email）。**主管理员（email = mainAdminEmail）不可被停用：** 该行 `#checkboxusersetting` disable，onChange 时 isMainAdmin 则 return。
- **银行下拉：** `getBanks()` 填 `#dropdownbanknameusersetting`。
- **新建/编辑：** `#boxeditusersetting` 内用 `#inputnameusersetting`、`#inputemailusersetting`、`#inputsalaryusersetting`、`#inputbankaccountusersetting`、`#dropdownbanknameusersetting`、`#checkboxgroupusersetting`；`createStaff` / `updateStaff(staffId, { name, email, salary, bankAccount, bankName, permission, status?, **syncToAccounting: true** })`。**仅在此处**（`#buttonupdateusersetting` 点击时）传 `syncToAccounting: true`，后端在保存后对该 client 已启用的 4 个 account system（xero/bukku/autocount/sql）执行 get contact / create contact，并把 contactId 写入 `staffdetail.account`（需 client 有 pricing plan 且已集成）。

## 5. Admin 区块

- **加载：** `getAdmin()` → `admin` 对象填 payout/salary/rental/deposit/agreementFees/otherFees/parking/smartDoor/meter/commissionDate/commissionRules 等控件。
- **保存：** 从表单收集为 `admin` 对象后 `saveAdmin(admin)`。
- **sectionprofile（员工编辑自己 profile）：** 与 **tenant 的 sectionprofile 一模一样**——同一套 input 与 HTML ID：`#inputfullnametenant`、`#inputemailtenant`、`#inputcontacttenant`、`#inputaddresstenant`、`#inputnrictenant`、`#dropdownbankname`、`#inputbankaccountno`、`#inputbankaccountholder`、`#dropdownregnotype`、`#dropdownentitytype`、`#inputtaxidno`、`#buttonsaveprofile`、`#buttoncloseprofile`。打开时从 `staff.profile` 初始化 entity/regno/tax。保存时调用 `updateStaff(accessCtx.staff.id, { name, email, bankAccount, bankName, **profile: { entity_type, reg_no_type, tax_id_no }** })` 写入 **staffdetail**（含 `staffdetail.profile`）。**不传** `syncToAccounting`，故不会触发 4 个 account system 的 contact 同步（仅 User Setting 的 `#buttonupdateusersetting` 会触发）。`#buttoncloseprofile` 返回上一 section（admin）。**与 User Setting 无关**（User Setting 是 admin 管理他人 permission/active，用 `#boxeditusersetting` 与 `#inputnameusersetting` 等）。

## 6. Topup 区块（不变）

- 仍用 `getMyBillingInfo()` 显示当前 credit；用 `getCreditPlans()`（billing JSW）填 repeater；结账用 `startNormalTopup({ creditPlanId, redirectUrl: wixLocation.url })`。

## 7. 集成 Onboard（替代原 #boxintegration / #repeaterintegration）

以下四个按钮不再打开 integration box/repeater，改为直接调 ECS 并写 MySQL（client_integration / client_profile）。  
**约定：** 所有「点击后跳转或提交」的按钮：先 **disable**、label 改为 `Loading...`，**await** 接口返回后再 `wixLocation.to(url)`；若接口抛错则 **enable** 并恢复原 label，不跳转。

### 7.1 #buttonstripeonboard

- 点击：先 `$w('#buttonstripeonboard').disable()` 且 `label = 'Loading...'`，再 `const result = await getStripeConnectOnboardUrl({ returnUrl: wixLocation.url, refreshUrl: wixLocation.url })`。
- 若返回 `result.alreadyConnected === true`：提示「已连接」，恢复按钮 enable 和原 label。
- 否则若 `result.url`：`wixLocation.to(result.url)` 跳转 Stripe Connect onboarding（完成后 Stripe 重定向回 `returnUrl`，ECS 已把 `stripe_connected_account_id` 写入 `client_profile`）。
- 若接口抛错：`catch` 里恢复按钮 enable 和原 label，不跳转。

### 7.2 #buttoncnyiotonboard

- 先弹出/展开选择：**Create New Account** 或 **Connect Existing Account**。点击提交时：**disable** 按钮 + label `Loading...`，await 完成后再关闭弹窗或跳转；出错则 **enable** + 恢复 label。
- **Create：** `await cnyiotConnect({ mode: 'create' })`。后端会为 client 建 CNYIoT 子账号并写入 `client_integration`（key=meter, provider=cnyiot）。若 client 尚未有 subdomain 会报错，需先填好 profile 的 subdomain。
- **Existing：** 表单：Username、Password；提交 `await cnyiotConnect({ mode: 'existing', username, password })`。后端写入 `client_integration`（meter/cnyiot）。

### 7.3 #buttonaccountonboard（Xero / Bukku / SQL / AutoCount）

- **权限：** 仅当 client 主方案在 **ACCOUNTING_PLAN_IDS** 内时允许连接 Accounting（见 [docs/readme/index.md § Company Setting](../readme/index.md)）。Access 返回 `capability.accounting`（套餐允许）、**`capability.accountProvider`**（已 onboard 的 provider）、**`capability.accountingReady`**（已 onboard 且 Account Setting 页所有 item 已 sync）、`capability.accountingSyncedTotal` / `accountingSyncedMapped`（模板总数/已映射数，可显示「3/5 synced」）。**`capability.accounting === true` 不代表已连接**，要看 `accountProvider`；**accounting ready** = onboard 已 integrate 好 + Account Setting 所有 item 已 sync。
- **按钮文案** 可由 **access context 的 `capability.accountProvider`** 或 **`getOnboardStatus().accountingProvider`** 决定：
  - 未连接：`Accounting Connect`
  - 已连 Xero：`Connecting Xero`；已连 Bukku：`Connecting Bukku`；已连 SQL：`Connecting SQL`；已连 AutoCount：`Connecting AutoCount`
- **点击流程：**
  - 若已连接：打开 `#boxonboard` 编辑当前 provider（标题如 Accounting Edit (Xero)）。
  - 若未连接：打开 `#boxaccountselection`，`#dropdownaccountonboard` 选项来自 **ECS getIntegrationTemplate()** 的 `addonAccount.provider` 下拉（默认 Xero、Bukku、SQL Account、AutoCount）。用户选一项后点 `#buttonsubmitaccountselection`：
    - **选 Xero**：直接调 `getXeroAuthUrl({ redirectUri: wixLocation.url })`，拿到 `result.url` 后 `wixLocation.to(result.url)` 跳转 Xero OAuth，不弹出 Token/Subdomain 表单。
    - **选 Bukku / SQL / AutoCount**：弹出 `#boxonboard`，Bukku 为 Token + Subdomain，其余为 Username + Password；提交时分别调 `bukkuConnect` 等。
- **Xero 回调：** 页面 onLoad 时若 URL 带 `?code=`，`handleXeroCallbackIfNeeded()` 会调 `xeroConnect({ code, redirectUri })`，刷新按钮文案后 `wixLocation.to(redirectUri)` 清掉 query。
- **后端：** Access context 已带 `capability.accountProvider`（同上）。`getOnboardStatus` 也返回 `accountingProvider`（来自 `client_integration` addonAccount），可用于刷新或与 access 一致。

### 7.4 #buttonttlockonboard

- 先选择 **Create New Account** 或 **Connect Existing Account**。提交时：**disable** 按钮 + `Loading...`，await 后再关弹窗；出错则 **enable** + 恢复 label。
- **Create：** `await ttlockConnect({ mode: 'create' })`。后端为 client 建 TTLock 子账号并写入 `client_integration`（smartDoor/ttlock）。
- **Existing：** 表单：Username、Password；提交 `await ttlockConnect({ mode: 'existing', username, password })`。

## 8. 数据与表对应（MySQL，不用 JSON 混用）

- **pricing plan：** `client_pricingplan_detail` + `clientdetail.pricingplan_id`（ECS billing 已用）。
- **client credit：** `client_credit` + `creditlogs`（ECS billing 已用）。
- **integration：** `client_integration`（key, slot, provider, values_json, enabled）；Stripe Connect 用 `client_profile.stripe_connected_account_id`。
- **profile：** `client_profile`（ssm, address, contact, subdomain, tin, accountholder, accountnumber, bank_id） + `clientdetail`（title, currency, profilephoto）。
- **admin：** `clientdetail.admin`（JSON 存 payout/salary/rental/deposit/commission 等）。

以上由 ECS 读写，前端仅通过 JSW 调 API，不再直接读 Wix CMS。
