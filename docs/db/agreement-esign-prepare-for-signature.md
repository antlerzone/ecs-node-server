# Agreement e-sign：资料齐全才生成 PDF、生成后才可签且才出现在 repeater

## 流程约定

1. **资料收集（Draft）**：Owner / Tenant 填资料；系统不在此阶段生成 PDF，也不允许签名。
2. **生成签署版**：当合约资料齐全时，调用 **prepare-for-signature** 服务 → merge 模板生成 Draft PDF → 计算 `hash_draft` → 存 MySQL（version=1，status=`ready_for_signature`）。
3. **Repeater 与签名**：只有 status 为 `ready_for_signature` / `locked` / `completed` 且已有 url 的 agreement 才会出现在 repeater；访客只能对这类记录签名。
4. **后续（未在本阶段实现）**：第一人签名后文档 LOCKED；双方签完后生成 Final PDF、`hash_final`、status=`completed`。

## 三种合约类型

| 类型 | mode | 参与方 | 资料齐全 = context 可成功构建 |
|------|------|--------|------------------------------|
| (1) owner & tenant | owner_tenant | 业主 + 租客 | tenancy + tenant + owner + room + property + client |
| (2) tenant & operator | tenant_operator | 租客 + 运营方 | tenancy + tenant + room + property + client |
| (3) owner & operator | owner_operator | 业主 + 运营方 | owner + property + client |

## API

- **POST /api/agreement/is-data-complete**  
  Body: `{ email, agreementId }`。  
  返回 `{ ok, reason? }`：资料齐全可生成 PDF 时 `ok: true`。

- **POST /api/agreement/prepare-for-signature**  
  Body: `{ email, agreementId }`。  
  当资料齐全时：生成 Draft PDF，写入 `url`、`hash_draft`、`version=1`、`status=ready_for_signature`。  
  返回 `{ ok, agreementId, pdfUrl?, hash_draft?, alreadyReady?, reason? }`。  
  只有在此成功之后，该 agreement 才会在 repeater 中显示并允许签名。

## 后端逻辑

- **agreement.service.js**  
  - `isAgreementDataComplete(agreementId)`：按 agreement 的 mode 取对应 context（owner_operator / tenant_operator / owner_tenant）；context 成功即视为资料齐全。  
  - `prepareAgreementForSignature(agreementId)`：若已是 `ready_for_signature`/`locked`/`completed` 且已有 url，直接返回；否则检查资料齐全 → 调 `generatePdfFromTemplate`（Node）→ 更新 `url`、`pdfurl`、`hash_draft`、`version=1`、`status=ready_for_signature`。

- **Repeater 过滤**  
  - **Owner Portal**（getAgreementList）：只返回 `status IN ('ready_for_signature','locked','completed')` 且 `(url IS NOT NULL OR pdfurl IS NOT NULL)` 的 agreement。  
  - **Tenant Dashboard**（init 里的 agreements）：同上，只返回已有 PDF 且可签的 agreement。

## 数据库

- **Migration 0053_agreement_hash_draft_final_version.sql**：为 agreement 表增加 `hash_draft`、`hash_final`、`version`。  
- **Migration 0054_agreement_signed_ip.sql**：为 agreement 表增加 `operator_signed_ip`、`tenant_signed_ip`、`owner_signed_ip`（varchar(45)），签名时记录请求端 IP（ECS 可能被 apps/webbrowser 等代理调用，从 `X-Forwarded-For` / `X-Real-IP` 取客户端 IP）。  
- 使用前需先执行上述 migration。

## 前端建议

1. 在「发邀请」或「创建 agreement 行」后，在合适时机（例如业主/租客资料已填完）调用 **is-data-complete**；若 `ok` 则再调 **prepare-for-signature**。  
2. 仅当 **prepare-for-signature** 成功返回 `pdfUrl` 后，再在 UI 上将该 agreement 视为「可签」并出现在 repeater（后端已按 status/url 过滤，前端只需按返回列表渲染）。  
3. 签名时（后续实现）应校验当前 PDF 的 hash 与 `hash_draft` 一致，并记录 signed_hash、timestamp 等。
