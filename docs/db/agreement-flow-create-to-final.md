# Agreement 整套流程：从 Create 到 Final

## 约定

- **Tenancy setting 页** = tenancy agreement（tenant_operator / owner_tenant）。
- **Property（propertydetail/ownersetting）** = management agreement（owner_operator）。
- **Manual upload**：property & tenancy 若为手动上传 PDF，写入 agreement 表后直接 **status=completed、columns_locked=1**，不做 hash。
- **两段 Hook**：1) profile 齐 → 生成 draft PDF；2) 签名齐 → 生成 final PDF。

## 目标生命周期

```
Create row (pending, 必带 agreementtemplate_id)
  → [Hook 1] 资料齐 → try-prepare-draft / prepare-for-signature (Draft PDF, hash_draft, ready_for_signature)
  → 签名 → 第一人签后 status = locked
  → [Hook 2] 双方/三方签完 → afterSignUpdate 内生成 Final PDF、hash_final、status=completed、columns_locked=1
```

---

## 数据库：columns_locked

- **Migration 0055_agreement_columns_locked.sql**：新增 `columns_locked`（tinyint(1) DEFAULT 0）。
- 当 `columns_locked=1` 时，除 `url`、`pdfurl`、`hash_final`、`status`、`updated_at` 外不得更新（代码中在签名接口里检查，拒绝在已完成时再签）。
- 在「签名齐 → 生成 final PDF」时设为 1。

---

## 两段 Hook 实现

| Hook | 说明 | 实现 |
|------|------|------|
| **1) profile 齐 → draft PDF** | 资料齐全后生成签署版 PDF | **POST /api/agreement/try-prepare-draft** `{ agreementId }`：若 agreement 无 url 且 is-data-complete，则调 prepare-for-signature。前端或定时任务可调。 |
| **2) 签名齐 → final PDF** | 双方/三方签完后生成最终 PDF | 各签名接口（operator/tenant/owner）成功更新后调用 **afterSignUpdate(agreementId)**：若当前 status=ready_for_signature 则置 locked；若已全签则 **generateFinalPdfAndComplete**（生成 PDF、写 hash_final、status=completed、columns_locked=1）。 |

---

## 一、Create（创建 agreement 行）

| mode | 创建入口 | 当前实现 | 说明 |
|------|----------|----------|------|
| **owner_operator** | Ownersetting 发业主邀请 | ✅ 有 | `ownersetting.service.js`：发邀请时 INSERT agreement，`status='pending'`，带 `agreementtemplate_id`、`owner_id`、`property_id`、`client_id`。 |
| **tenant_operator** | Tenancy setting 页 | ✅ 已接 | `tenancysetting.insertAgreement` 已支持 **agreementtemplate_id**（body `templateId`），默认 **status='pending'**；若传 **url**（manual upload）则 status='completed'、columns_locked=1。 |
| **owner_tenant** | Tenancy setting 页 | ✅ 同左 | 同上，同一 insertAgreement 入口。 |
| （旧路径） | agreement.requestPdfGeneration | ✅ 有但混用 | 会 INSERT 行 `status='pending'`，然后**立即**生成 PDF；若用 Node 则调 `finalizeAgreementPdf` 直接设成 `status='completed'`，**无 hash_draft、无签署流程**，与「资料齐全 → prepare → 签名」流程是两套。 |

**说明：**  
- owner_operator 仍在 ownersetting 发邀请时创建（已有 agreementtemplate_id、pending）。  
- Property 若日后支持 manual upload，插入时带 url 并设 status=completed、columns_locked=1 即可（与 tenancy manual upload 一致）。
- **Tenancy 模板创建扣平台 credits：** `POST /api/tenancysetting/agreement-insert` 在 **有 templateId 且无手动 url** 时，需 body **`confirmCreditDeduction: true`**；服务端在同一事务内调用 `deductClientCreditSpending`，扣费数量来自 **`clientdetail.admin` JSON 的 `agreementCreationCredits`**（缺省 **10**）。手动上传（带 url）不扣费。重试 draft PDF 不重复扣费。
- **双方签完后需生成 Final PDF：** `generateFinalPdfAndComplete` 会读 `operator_signed_at` / `operator_signed_hash`（**0090**）。若库未跑 **0090**，旧环境会打日志并降级 SELECT；仍建议在 ECS 执行 **`0090_agreement_operator_signed_at_hash.sql`**。未跑 0090 时，租客签完可能曾在日志出现 `afterSignUpdate Unknown column 'operator_signed_at'`，协议卡在 `locked` +「双方已签」，Operator 列表若误把 **Sign** 开放给 `pending_signatures` 会看起来像「要再签一次」——前端已改为仅在 **Awaiting Operator**（`pending_operator`）显示 Sign。
- **租客门户下载：** Tenant `/tenant/agreement` 仅当 **`agreement.status === 'completed'`** 时允许 **Download final**；仅租客已签（`locked` / `ready`）时只显示「You signed」日期，不提供最终下载。租客签名时间写入 **`tenant_signed_at`**（迁移 **`0133_agreement_tenant_signed_at.sql`**）；未跑迁移时可用 **`agreement.updated_at`** 作近似显示。若双方已签仍非 `completed`，多为 **`generateFinalPdfAndComplete` 失败**（Google/Drive/OAuth/配额）；`afterSignUpdate` 现已打错误日志。运营可在 **Operator → Agreements** 对 **Signatures pending** 行点 **Finalize**，调用 **`POST /api/admindashboard/agreement/retry-final-pdf`** 重试生成最终 PDF。
- **排障日志（发给开发）：** 在 ECS 上 `pm2 logs`（或应用 stdout）里 **grep `agreement-final-pdf`**。每条是一行 **JSON**，字段含 `phase`（如 `afterSignUpdate`、`generateFinalPdfAndComplete`、`retryAgreementFinalPdf`）、`outcome`、`reason`、`agreementId`、`status`、`mode`、各签名字段是否已写入（`has_tenantsign` / `has_operatorsign` / `has_ownersign`，**不含**签名内容）、Google 失败时的 `errorMessage` / `stack` 摘要等。复制**整行 JSON**即可定位「未触发 finalize」还是「Google/Drive/模板/凭证」问题。

---

## 二、资料齐全 → Prepare（Draft PDF）

| 步骤 | API / 逻辑 | 状态 |
|------|------------|------|
| 判断资料是否齐全 | **POST /api/agreement/is-data-complete** `{ agreementId }` → `isAgreementDataComplete(agreementId)` | ✅ 已实现 |
| 生成签署版 PDF | **POST /api/agreement/prepare-for-signature** `{ agreementId }` → 生成 Draft PDF，写 `url`、`pdfurl`、`hash_draft`、`version=1`、`status=ready_for_signature` | ✅ 已实现 |
| 前端调用时机 | 创建 agreement 行后，业主/租客资料填完时，先 is-data-complete，再 prepare-for-signature | ⚠️ **Wix 前端未接** | 
| 文档约定 | 见 `docs/db/agreement-esign-prepare-for-signature.md` | ✅ 已写 |

**缺口：**

- Owner Portal / Admin / 其他 Wix 页在「资料填完」或「可生成 PDF」的时机，**尚未**调用 `is-data-complete` 与 `prepare-for-signature`，需在前端接上。

---

## 三、签名（含 IP）

| 参与方 | 接口 | 写入字段 | 状态 |
|--------|------|----------|------|
| 运营方 (operator) | POST /api/admindashboard/agreement/operator-sign | operatorsign, operator_signed_ip | ✅ 已实现 |
| 租客 (tenant) | POST /api/tenantdashboard/agreement-update-sign | tenantsign, tenant_signed_ip, status(可选) | ✅ 已实现 |
| 业主 (owner) | POST /api/ownerportal/agreement-update-sign | ownersign, owner_signed_at, owner_signed_ip, status(可选) | ✅ 已实现 |
| Repeater 过滤 | 只显示 status IN ('ready_for_signature','locked','completed') 且 url/pdfurl 存在 | ✅ 已实现（ownerportal / tenantdashboard / admindashboard） |

**已实现：** 各签名接口成功后调用 **afterSignUpdate(agreementId)**，若当前 status=ready_for_signature 则更新为 **locked**。

---

## 四、Final（双方/三方签完 → completed + hash_final）

| 步骤 | 说明 | 状态 |
|------|------|------|
| 判断「全部签完」 | 按 mode：owner_operator → ownersign + operatorsign；tenant_operator → operatorsign + tenantsign；owner_tenant → ownersign + tenantsign | ✅ **isAgreementFullySigned(row)** |
| 生成 Final PDF | 全部签完后用当前 context + 签名图生成 PDF，计算 hash_final | ✅ **generateFinalPdfAndComplete(agreementId)** |
| 写回 DB | 更新 url、pdfurl、hash_final、status=completed、columns_locked=1；并更新 propertydetail/tenancy 的 agreement 快照 | ✅ 已实现 |
| 触发时机 | 各签名接口成功后在 route 中调用 **afterSignUpdate(agreementId)** | ✅ 已接 |

**已实现：** 见上表；afterSignUpdate 内调用 generateFinalPdfAndComplete。

---

## 五、数据库与迁移

| 项目 | 说明 | 状态 |
|------|------|------|
| hash_draft / hash_final / version | 0053_agreement_hash_draft_final_version.sql | ✅ 已存在 |
| operator/tenant/owner_signed_ip | 0054_agreement_signed_ip.sql | ✅ 已存在 |
| columns_locked | 0055_agreement_columns_locked.sql | ✅ 已存在 |
| 执行顺序 | 0053 → 0054 → 0055 | 部署前需执行 |

---

## 六、总结：完整度一览

| 阶段 | 完整度 | 说明 |
|------|--------|------|
| Create | ✅ | owner_operator（ownersetting）；tenant_operator/owner_tenant（tenancysetting.insertAgreement 带 templateId、pending；manual url → completed + columns_locked）。 |
| 资料齐 + Prepare | ✅ 后端 / ⚠️ 前端可接 | is-data-complete、prepare-for-signature、**try-prepare-draft** 已实现；前端可在资料齐后调 try-prepare-draft 或 prepare-for-signature。 |
| 签名 + IP | ✅ | 三方签名接口写 signed_ip，且检查 columns_locked 拒绝已完成。 |
| 第一人签 → locked | ✅ | afterSignUpdate 内将 ready_for_signature 置为 locked。 |
| 全签完 → Final PDF | ✅ | afterSignUpdate 内 isAgreementFullySigned → generateFinalPdfAndComplete（hash_final、completed、columns_locked=1）。 |

**两段 Hook：**

1. **Profile 齐 → draft PDF**：调 **POST /api/agreement/try-prepare-draft** `{ email, agreementId }`（或 prepare-for-signature）。
2. **签名齐 → final PDF**：由各签名接口在成功写库后自动调 **afterSignUpdate(agreementId)**，无需前端再调。

---

## Google Docs / Drive 封装（Agreement 用）

- **唯一入口**：`src/modules/agreement/google-docs-pdf.js`
  - **getAuth()**：从环境变量取 `GOOGLE_SERVICE_ACCOUNT_JSON` 或 `GOOGLE_APPLICATION_CREDENTIALS`，返回 Google Auth，无则返回 null。
  - **generatePdfFromTemplate({ templateId, folderId, filename, variables })**：用 Docs API 复制模板、替换 `{{key}}` 与图片占位；**签名类占位**（`sign` / `ownersign` / `tenantsign` / `operatorsign`）在无图片 URL 时**不删除**，草稿 PDF 仍保留 `{{…}}` 文案，避免终稿无法插入签名图。NRIC/chop 等无 URL 时仍会清空占位。
  - **终稿**：`generateFinalPdfAndComplete` 用 `returnBufferOnly` 生成主 PDF → **pdf-lib** 合并 **Execution & audit schedule** 尾页（`agreement-pdf-appendix.js`：`hash_draft`、主文 SHA-256、operator_signed_at/hash/IP、owner/tenant IP 等）→ 再上传 Drive；**hash_final** = 整份合并后 PDF 的 SHA-256。
- **调用方**：仅 **agreement.service.js** 引用该模块，用于：
  - **prepareAgreementForSignature**（draft PDF + hash_draft）
  - **generateFinalPdfAndComplete**（final PDF + 审计尾页 + hash_final）
  - **requestPdfGeneration**（Node 分支，有 getAuth 时直接出 PDF）
- **环境**：配置好上述任一 Google 凭证即可；未配置时 prepare/final 与 request-pdf 会报 `GOOGLE_CREDENTIALS_REQUIRED`（已无 GAS 回退）。
- **结论**：Agreement 相关的 Google Docs / Drive 逻辑都集中在一个模块内，对外只暴露 `generatePdfFromTemplate` 和 `getAuth`，是完整封装。
