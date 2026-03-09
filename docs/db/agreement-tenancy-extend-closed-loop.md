# Agreement 与 Tenancy：一租约多合约 + 闭环说明

## 一、一个 Tenancy 可以有多份 Agreement（含续约）

- **表 `agreement`**：每行一条合约实例，`tenancy_id` 指向同一租约时可有多行。
- **场景**：同一租约先签一份（tenant_operator / owner_tenant），延租后再在 Tenancy Setting 用「协议」+ datepicker 创建**续约合约**（extend agreement），即同一 `tenancy_id` 会有第二行 agreement（extend_begin_date / extend_end_date / remark 可选）。
- **Tenancy Setting**：`insertAgreement` 只 INSERT 一行，不限制同一 tenancy 已有几行；列表按 `tenancy_id` 查 agreement，返回该租约下**全部**合约（含多份）。
- **结论**：一个 tenancy 对应多份 agreement（首签 + 续约）在表结构和业务上都是支持的。

---

## 二、数据流与模块分工

| 模块 | 表/职责 | 与 agreement 的关系 |
|------|---------|---------------------|
| **Agreement Setting** | `agreementtemplate`：模板 CRUD（list/create/update/delete、generate-html） | 只管模板，不写 `agreement` 表。Tenancy Setting 创建合约时带 `templateId`，即用这里的模板。 |
| **Tenancy Setting** | 租约列表、延租/换房/终止、**协议** | 用 `agreementtemplate` 的 id 作 `agreementtemplate_id` 调用 `insertAgreement`，写入 `agreement`（tenancy_id, mode, templateId, status=pending；可选 extend_begin_date, extend_end_date, remark）。列表从 `agreement` 按 tenancy_id 取多行。 |
| **Agreement 模块** | 上下文、draft/final PDF、hash、签名后更新 | 按 `agreement.id` 单行处理：is-data-complete、prepare-for-signature、try-prepare-draft、签名接口、afterSignUpdate → generateFinalPdfAndComplete。每行独立 hash_draft / hash_final / status。 |
| **Tenant Dashboard** | 租客看租约、待签合约、租金 | 从 `agreement` 表按 `tenancy_id IN (...)` 且 status IN ('ready_for_signature','locked','completed') 且 (url OR pdfurl) 列出**该租约下所有可签/已签合约**（含续约）。签时传 `agreementId`，只更新对应那一行。 |
| **Admin Dashboard** | 待运营签的合约 | 从 `agreement` 按 client、mode、operatorsign 为空、status 为 ready_for_signature/locked 且已有 url 列出；签时传 `agreementId`，afterSignUpdate 只处理该行。 |
| **Owner Portal** | 业主签 owner_tenant / owner_operator | 同上，按 `agreementId` 签单行，afterSignUpdate 只处理该行。 |

---

## 三、从创建到 Final 的闭环（含 hash）

### 1. 创建行（Create）

- **Tenancy Setting**：`POST /api/tenancysetting/agreement-insert` → `insertAgreement` → INSERT `agreement`（tenancy_id, mode, agreementtemplate_id, status='pending'，可选 extend_begin_date, extend_end_date, remark）。
- **Owner Setting / 发邀请**：INSERT agreement（owner_operator，pending）。
- 此时无 url、无 hash_draft，status=pending。

### 2. 资料齐 → Draft PDF（Hook 1）

- **POST /api/agreement/is-data-complete** `{ agreementId }`：检查该行资料是否齐（tenancy/owner/operator 等按 mode 校验）。
- **POST /api/agreement/prepare-for-signature** 或 **POST /api/agreement/try-prepare-draft** `{ agreementId }`：  
  若资料齐且尚无 url，则生成 draft PDF，写 `url`、`pdfurl`、`hash_draft`、`version=1`、`status=ready_for_signature`。
- **谁调**：文档约定由前端在「资料齐」时调 try-prepare-draft；若 Wix 未接，新创建的 agreement（含续约）会一直 pending，直到某处调 try-prepare-draft 后才会出现在 Tenant/Admin 的「待签」列表（因列表过滤了 status 与 url）。

### 3. 签名（Sign）

- **租客**：POST /api/tenantdashboard/agreement-update-sign `{ agreementId, tenantsign, ... }`。
- **运营**：POST /api/admindashboard/agreement/operator-sign `{ agreementId, operatorsign }`。
- **业主**：POST /api/ownerportal/agreement-update-sign `{ agreementId, ownersign, ... }`。
- 各接口写对应 sign 字段与 signed_ip，并调用 **afterSignUpdate(agreementId)**：
  - 若当前 status=ready_for_signature → 改为 locked；
  - 若该行已全签（按 mode 判断 ownersign/tenantsign/operatorsign）→ 调用 **generateFinalPdfAndComplete(agreementId)**。

### 4. 全签完 → Final PDF + hash_final（Hook 2）

- **generateFinalPdfAndComplete(agreementId)**（仅针对该 agreement 行）：
  - 用当前 context + 签名图生成 final PDF；
  - 写回 `url`、`pdfurl`、`hash_final`、`status=completed`、`columns_locked=1`；
  - 更新 **tenancy.agreement**（或 propertydetail）：按 `agreementId` 在 JSON 数组里更新/追加该行的快照（url、updatedAt 等）。
- **tenancy.agreement**：一个 tenancy 多份 agreement 时，该 JSON 数组会含多个快照（每个 agreementId 一条），与 `agreement` 表多行一一对应。

### 5. 闭环小结

| 环节 | 是否按 agreement 行独立 | 是否封圈 |
|------|--------------------------|----------|
| Create | 每行一条 INSERT（tenancy_id 可同） | ✅ Tenancy Setting / Owner 发邀请 |
| Draft PDF (hash_draft) | 按 agreementId 调 try-prepare-draft / prepare-for-signature | ✅ 后端已实现；前端需在适当时机调 try-prepare-draft |
| 列表（Tenant / Admin） | 从 agreement 表按 tenancy_id 查多行，过滤 status + url | ✅ 多份合约都会列出 |
| 签名 | 传 agreementId，只更新该行 | ✅ 三个入口都接 afterSignUpdate |
| Final PDF (hash_final) | 按 agreementId 生成并写回该行 + tenancy.agreement 快照 | ✅ afterSignUpdate → generateFinalPdfAndComplete |

---

## 四、结论

- **一个 tenancy 两个（或更多）租约**：表结构支持；Tenancy Setting 列表、Tenant Dashboard 列表、签名、Final PDF 均按 **agreement 行（agreementId）** 处理，互不串行。
- **Agreement Setting**：只负责模板（agreementtemplate），与 agreement 行通过 `agreementtemplate_id` 衔接，不写 agreement 表。
- **Tenant Dashboard**：列出该租客所有 tenancy 下所有「可签/已签」agreement 行，签时按 agreementId 提交，与 final hash 闭环一致。
- **Final agreement hash**：每行独立 hash_draft / hash_final；全签后仅对该行调用 generateFinalPdfAndComplete，写 hash_final、completed、columns_locked，并更新 tenancy.agreement 中该 agreementId 的快照。
- **唯一需前端配合**：新 agreement 行（含续约）创建后，若希望立刻出现在「待签」列表，需在合适时机调用 **POST /api/agreement/try-prepare-draft** `{ email, agreementId }`；否则该行会保持 pending 直到某处触发 try-prepare-draft。

以上为当前代码与文档下的完整闭环说明。
