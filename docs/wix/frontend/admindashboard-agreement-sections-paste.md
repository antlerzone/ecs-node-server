# Admin Dashboard：粘贴 #sectionproperty、#sectionagreement 与 Operator 签名

从 Owner Portal 把 **#sectionproperty** 和 **#sectionagreement** 粘贴到 Admin Dashboard，让员工（operator）在后台签署 tenant_operator / owner_operator 合约。

---

## 1. 后端已实现

- **getAdminList** 已包含 `filterType: 'Agreement'`，并合并 **listPendingOperatorAgreements**：列出本 client 下待 operator 签名的 agreement（mode = tenant_operator 或 owner_operator，operatorsign 为空，status = ready_for_signature / locked，且已有 url）。
- **POST /api/admindashboard/agreement/operator-sign**：Body `{ email, agreementId, operatorsign }`，更新 `agreement.operatorsign`。
- JSW：**signAgreementOperator**（`backend/saas/admindashboard`）调上述 API。

---

## 2. #repeateradmin：待 Operator 签名的项

- 列表中 **Pending Operator Agreement** 项：
  - **#textadmindescription**：`room name | tenant name`（owner_operator 无 tenant 时用 property shortname | "Owner"）。
  - **#buttonviewdetail**：label = **"Sign Agreement"**，点击 → **openAgreementSectionForOperator(item)** → 切到 **#sectionagreement** 并打开该 agreement（加载 template + context，显示 #boxagreement）。
- Feedback / Refund 项保持原样（More Detail / openRefundBox / openDetailSection）。
- **#dropdownfilter** 增加选项 **Agreement**，筛选只显示待签 agreement。

---

## 3. Section Tab：#buttonagreementlist

- 与 **#buttonadmin** 一起在 **startInit 时 disable**，init 完成后 **enable**。
- 点击 **#buttonagreementlist** → **switchSectionAsync('property')**，打开 **#sectionproperty**（按物业+状态看租约；#repeatertenancy 仅显示当前 Staff 做的 booking 的 tenancy）。

---

## 4. 从 Owner Portal 粘贴的区块

### 4.1 #sectionproperty

- **打开方式**：点击 **#buttonagreementlist** → switchSectionAsync('property')（无 #buttonproperty）。
- **#dropdownstatus**（由原 #dropdownoperator 改名）：Options = **Active** / **Inactive**。
- **#dropdownproperty**：选项 = 当前 client 的 properties。
- **#texttitleproperty**、**#texttenantname**、**#texttenancydate**、**#textrental**：房间/租客/租期/租金。
- **#repeatertenancy**：数据 = **当前 Staff 创建或延期的 tenancy**（API 传 staffId，后端按 tenancy.submitby_id 或 tenancy.last_extended_by_id 筛选：Booking 记 submitby_id，Extend 记 last_extended_by_id）；可按 #dropdownproperty、#dropdownstatus 再筛。
- **#buttontenanttenancy**：点击 → 打开 #sectionagreement 并打开该 tenancy 下第一条有 url 的 agreement（getAgreementForOperator → openAgreementSectionForOperator）。
- **#buttoncloseproperty**：点击 → 返回上一个 section。

### 4.2 #sectionagreement

- **#boxagreement**、**#signatureinputagreement**、**#htmlagreement**、**#buttonagree**、**#buttoncloseagreement**。
- **#repeateragreement 已删除**：operator 从 repeateradmin 或 repeatertenancy 点进某一条再打开 agreement，直接显示该条并签名。
- **#buttonagree**：员工签名后调用 **signAgreementOperator**，成功则关闭 box、**返回上一个 section**（admin），并刷新 admin 列表。
- **#buttoncloseagreement**：关闭 box 并返回 admin。

---

## 5. 数据与 API 对应

| 用途 | 数据来源 / API |
|------|----------------|
| repeateradmin 待签 agreement | getAdminList（filterType: 'Agreement' 或 'ALL'），含 listPendingOperatorAgreements |
| Operator 签名 | signAgreementOperator({ agreementId, operatorsign }) → POST /api/admindashboard/agreement/operator-sign |
| Agreement HTML（operator 打开） | getAgreementTemplate(templateId) + getTenantAgreementContext / getOwnerAgreementContext（staffVars = 当前 staff），render 到 #htmlagreement |
| repeatertenancy | 当前 client 的 tenancy 列表（可按 property、status active/inactive 筛选）；需后端或现有 tenancy list API |
| dropdownproperty | 当前 client 的 property 列表 |

---

## 6. 前端已实现（admindashboard-page-full.js）

- **MAIN_SECTIONS** 已含 `'property'`, `'agreement'`。
- **#buttonadmin**、**#buttonagreementlist** 在 init 时 disable，完成后 enable。
- **repeateradmin** 对 `_type === 'PENDING_OPERATOR_AGREEMENT'`：description = `room | tenant`，button = "Sign Agreement"，onClick = **openAgreementSectionForOperator(item)**。
- **openAgreementSectionForOperator**：设置 currentOperatorAgreementItem，switch 到 agreement section，**loadOperatorAgreementHtml**（getAgreementTemplate + getTenantAgreementContext / getOwnerAgreementContext + staffVars from accessCtx）。
- **#buttonagree**：signAgreementOperator → 成功则关 box、loadAdminData、切回 admin。
- **#buttoncloseagreement**、**#buttoncloseproperty**：关 box 或返回 admin。
- **#dropdownfilter** 增加 Agreement；**applyAdminFilterAndRender** 对 filter Agreement 只保留 PENDING_OPERATOR_AGREEMENT。

---

## 7. 尚未粘贴的 UI（需在 Wix 编辑器中做）

- 在 Admin Dashboard 页从 Owner Portal **复制 #sectionproperty、#sectionagreement**（含 #boxagreement、#signatureinputagreement、#htmlagreement、#buttonagree、#buttoncloseagreement、#repeatertenancy、#dropdownproperty、#dropdownstatus、#buttontenanttenancy、#buttoncloseproperty 等）。
- 在 Section Tab 增加 **#buttonagreementlist**，与 **#buttonadmin** 并排；点击打开 **#sectionproperty**（按物业+状态看租约），**不**使用 #buttonproperty。
- **#dropdownoperator** 改名为 **#dropdownstatus**，Options 设为 Active / Inactive。
- **#repeatertenancy** 已接 tenancy list API（getTenancyList + getTenancyFilters）；**显示当前 Staff 创建或延期的 tenancy**（Booking 记 tenancy.submitby_id，Extend 记 tenancy.last_extended_by_id；后端筛选 submitby_id = staff OR last_extended_by_id = staff）。**#buttontenanttenancy** 点击时取该 tenancy 下第一条有 url 的 agreement，调 getAgreementForOperator 后 openAgreementSectionForOperator。
- **#repeateragreement** 已删除。
