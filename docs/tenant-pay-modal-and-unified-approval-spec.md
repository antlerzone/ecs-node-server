# Tenant Pay 弹框 + PayNow 流程 + 统一 Approval 页 — 需求规格

## 一、场景

- **入口**：Tenant 在 **Meter** 或 **Payment (Invoice)** 点击 **Pay** 时，先弹出支付方式选择弹框，再根据选择走不同流程。
- **PayNow（新加坡）**：选 PayNow 时走「上传收据 → 系统/人工核销」；若 operator 已连 Finverse 则自动拉 statement 核验，否则进 Approval 人工处理。
- **统一 Approval**：Operator 在一个页面处理所有待审批项：deposit refund、feedback、commission referral、payment verification。

---

## 二、Pay 弹框（Meter + Invoice 共用）

### 2.1 触发

- **Meter 页**：当前是选金额后直接「Confirm Payment」跳 Stripe。改为点击 **Pay** 时先打开弹框。
- **Payment (Invoice) 页**：当前是勾选未付 invoice 后点 **Pay Now** 直接 `createPayment`。改为点击 **Pay Now** 时先打开弹框。

### 2.2 弹框内容

- **标题**：例如 "Pay Now" 或 "选择支付方式"。
- **公司名称（必显）**：在弹框内明显位置显示 **Company name**（operator 的公司名，即 `client.title`），让 tenant 付款前核对收款方。  
- **提示（hint）**：在弹框内注明：**「请确认上方公司名称与您要付款的对象一致。若未核对即付款导致误转，责任由租户自行承担。」**（或英文：Please verify the company name above matches the payee. Tenant is responsible if payment is made to the wrong party without checking.)
- **选项（单选）**：
  1. **Credit card** — 信用卡（走 Stripe/Xendit）
  2. **Bank transfer** — 银行转账（走 Stripe/Xendit，或同一 gateway 的 bank transfer 方式，依现有实现）
  3. **PayNow** — 仅当 **client 为新加坡** 时显示（判断方式：client 的 `currency === 'SGD'` 或 client 有 `country: 'SG'` 等，需与现有 client/operator 配置一致）

- **主按钮**：**Pay Now**（与现有文案一致）。

### 2.3 选项 1 & 2（Credit card / Bank transfer）

- 与现有逻辑一致：调用 `createPayment({ tenancyId, type: 'meter'|'invoice', amount, metadata, returnUrl, cancelUrl })`，后端走 client payment gateway（Stripe 或 Xendit/Payex），返回 `redirect` URL 后 `window.location.href = url`。
- 无需改后端 create-payment 逻辑，仅在前端「先选方式再调 createPayment」。

### 2.4 选项 3（PayNow）

仅当 client 为新加坡时显示。选 PayNow 并点击 **Pay Now** 后：

1. **不跳转** Stripe/Xendit，改为进入 **PayNow 流程界面**（弹框内第二步或子视图）：
   - **公司名称**：明显显示 `client.title`（与主弹框一致），供 tenant 核对收款方。
   - **Pay to UEN**（仅 UEN，不用 QR）：
     - 显示 operator 的 **UEN**（Unique Entity Number），旁有 **Copy** 按钮；tenant 点击 Copy 后自行到 **PayNow 应用** 里粘贴 UEN、输入金额、完成付款，取得收据后回到本页上传。
     - 提示文案（hint）：**「请点击 Copy 复制 UEN，打开 PayNow 应用，粘贴 UEN 并输入付款金额，完成付款后保存收据截图，回到本页上传收据。」**
   - **金额**：本笔应付金额（meter 或 invoice 合计）明确显示，方便 tenant 在 PayNow 内输入相同金额。
   - **上传收据**：**Upload** 按钮，选择文件上传至 OSS，得到 `receipt_url`（利用 UEN 支付后必须上传收据）。
   - **Submit 按钮**：提交本笔 PayNow 支付（金额、tenancy、invoiceIds 或 meter、receipt_url）。

2. **Submit 后的后端逻辑**：
   - 创建 **payment_verification** 记录：即调用现有「上传收据」流程（如 `createInvoiceFromReceipt`），把本次 PayNow 的 amount、invoiceIds 或 meter 信息、tenant、receipt_url 等写入 `payment_receipt` + `payment_invoice`。
   - **若 operator 已连 Finverse**（有 `finverse_login_identity_token`）：
     - 触发一次 **Finverse 拉 statement**（调用现有 `syncBankTransactionsFromFinverse` 或等价逻辑），然后跑 **匹配引擎**（对应该 payment_invoice）。
     - **若匹配成功**：标记该 invoice/meter 为已付（mark as paid），并 **trigger accounting**（与现有 Stripe/webhook 后流程一致，写 rentalcollection/metertransaction 已付、入账等）。
     - **若匹配失败或未匹配**：该笔保留在 payment verification 的 **PENDING_REVIEW**，前端显示 **pending**（见下）。
   - **若 operator 未连 Finverse（manual mode）**：
     - 不调 Finverse，该笔直接进入 **Approval**，由 operator 在 Approval 页人工核对并 Approve/Reject。

3. **前端状态**：
   - 提交后若在「等待核验」或「待审批」：列表/详情处显示 **Pending**（或「待核验」），不显示为已付。
   - 核验通过并 mark as paid 后：刷新列表，显示已付；若有 accounting 集成则与现有逻辑一致。

### 2.5 新加坡 client 判断

- 需在后端或 init 接口中提供：当前 tenant 所属 client 是否支持 PayNow（例如 `client.currency === 'SGD'` 或 `client.country === 'SG'`）。
- 前端根据该标志在 Pay 弹框中 **仅当为 SG 时显示 PayNow 选项**。

---

## 三、统一 Approval 页

### 3.1 路由与入口

- **路径**：`portal.colivingjb.com/operator/approval`（与现有 operator approval 一致，将现有「Feedback + Payment verification」扩展为四种类型统一列表）。
- 侧栏保留 **Approval** 入口，角标数字 = 四种类型待处理总数。

### 3.2 数据类型与来源

| Type | 说明 | 数据来源（现有） |
|------|------|-------------------|
| **Deposit refund** | 退押金待处理 | `getAdminList` 中 `_type === 'REFUND'`（refunddeposit） |
| **Feedback** | 租客反馈待回复/处理 | `getAdminList` 中 `_type === 'FEEDBACK'` |
| **Commission referral** | 佣金/推荐金待发放 | `getAdminList` 中 `_type === 'COMMISSION_RELEASE'`（或现有 commission 列表 API） |
| **Payment verification** | 收据核验待审批 | `getPaymentVerificationInvoices({ status: 'PENDING_REVIEW' })` |

### 3.3 列表与表格

- **下拉筛选**：按 **Type** 筛选（All / Deposit refund / Feedback / Commission referral / Payment verification）。
- **搜索**：可按 **name**（租客/联系人名）、**room name**、**amount** 或备注等做前端或后端搜索（视现有 API 是否支持，可先做前端过滤）。
- **表格列**：
  - **Type**：Deposit refund | Feedback | Commission referral | Payment verification
  - **Name**：相关租客/联系人/tenant 名称
  - **Room name**：房间名（如有）
  - **Amount**：金额（如有；Feedback 可能无）
  - **Action**：每行操作按钮（见下）

### 3.4 每类 Action

- **Deposit refund**：打开详情/弹框，填写 refund amount、payment date、payment method 等，**Mark as refunded**（调用现有 refund/update 或等价接口）。
- **Feedback**：打开详情，**Reply**（填写 remark）、**Mark as done**（调用现有 updateFeedback）。
- **Commission referral**：打开详情，选择 staff、release amount、**Mark as paid**（调用现有 commission release 逻辑）。
- **Payment verification**：**View** 打开详情（收据 + 候选交易），**Approve** / **Reject**（调用现有 payment-verification approve/reject）。

### 3.5 实现要点

- 现有 `getAdminList` 已返回 feedback + refund + commission_release；payment verification 需单独 `getPaymentVerificationInvoices`。
- 前端将四类数据 **合并为一张表**，统一展示 Type / Name / Room / Amount / Action；Type 筛选与搜索在合并后的列表上做。
- 保持现有各类型的详情与操作 API 不变，仅把入口收敛到单一 Approval 页。

---

## 四、后端需补/改点（简要）

1. **create-payment**  
   - 可选：支持 `paymentMethod: 'paynow'` 且 client 为 SG 时，不创建 Stripe/Xendit session，而是返回 `{ ok: true, type: 'paynow', paynowFlow: true }`，由前端进入 PayNow 流程（展示 QR + 上传收据 + Submit）。或前端直接不调 create-payment，而是先选 PayNow 后调「创建 PayNow 支付 + 上传收据」的专用接口。

2. **PayNow 提交接口**  
   - 新接口或复用 payment-verification 的「上传收据并创建 invoice」：入参含 tenancyId、type（meter/invoice）、amount、invoiceIds（若 invoice）、meterTransactionId（若 meter）、receipt_url。  
   - 创建 `payment_receipt` + `payment_invoice` 后：  
     - 若 client 有 Finverse：调 `syncBankTransactionsFromFinverse` + 匹配引擎；匹配成功则 mark as paid + trigger accounting；失败则 PENDING_REVIEW。  
     - 若无 Finverse：直接 PENDING_REVIEW。

3. **PayNow：仅 UEN，不用 QR；Malaysia = SSM Number，Singapore = UEN Number**  
   - **已实现**：Company Setting 中 Malaysia 显示 **SSM Number**（存 `client_profile.ssm`），Singapore 显示 **UEN Number**（存 `client_profile.uen`）。Tenant 端当 client 为 SGD 时可选「Pay with PayNow」；弹窗内：公司名、**UEN Number + Copy**、金额、**Upload receipt**、**Submit**、**Hint** 按钮；tenant 复制 UEN 到 PayNow 应用付款后上传收据并提交（`submit-paynow-receipt`）。

4. **Client 是否新加坡**  
   - 在 tenant init 或 client 接口中返回 `client.supportsPayNow` 或 `currency === 'SGD'`，供前端控制 PayNow 选项显示。

5. **统一 Approval 列表**  
   - 前端合并 getAdminList（feedback + refund + commission）与 getPaymentVerificationInvoices(PENDING_REVIEW)；后端可保持现有 API，或新增一个「approval 汇总」接口返回四类合并列表（可选）。

---

## 五、实现顺序建议

1. **统一 Approval 页**：合并四类数据、筛选、搜索、列与 Action（不改 Pay 流程即可先上）。
2. **Pay 弹框**：Meter + Payment 点击 Pay 先出弹框，选项 Credit card / Bank transfer（+ 条件显示 PayNow）；前两项行为与现有一致。
3. **PayNow 流程**：Operator PayNow QR 配置 + 前端 PayNow 步骤（QR、提示、上传收据、Submit）+ 后端「PayNow 提交」接口 + Finverse 核验/人工 Approval 逻辑。
4. **新加坡判断**：client 支持 PayNow 的字段与 init 返回，前端仅 SG 显示 PayNow。

---

以上为完整需求规格，可按节实现与联调。
