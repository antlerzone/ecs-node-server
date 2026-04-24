# Cleanlemons Operator Agreement — 删除 + Draft/Final Hash（已确认范围）

**维护者已确认：阶段 A 与阶段 B 都要做**（删除弹窗 + 补齐 draft/final hash 与审计，对齐 Coliving 思路）。

## 阶段 A — 删除与确认弹窗

- 后端：`/api/cleanlemon/operator/agreements/:id` DELETE 或 `POST .../delete`；校验 `operator_id`；**禁止删除**当 `status` ∈ `complete` / `signed` 或 `final_agreement_url` 已非空（与 Coliving「有 final 不可删」一致）。
- 前端：`cleanlemon-api.ts` 增加 `deleteOperatorAgreement`；[agreement/page.tsx](cleanlemon/next-app/app/portal/operator/agreement/page.tsx) 用 AlertDialog/Dialog 替代 `toast.error` 占位；成功后刷新列表。
- 可选：模板行的 Delete/Edit 若为 toast 占位，一并接真逻辑或明确禁用。

## 阶段 B — Draft / Final Hash 与审计（必做）

**目标**：Cleanlemons 协议在「可签前」有稳定 **draft 内容哈希**，全部签完后有 **final 哈希**（可与 Coliving `hash_draft` / `hash_final` 及 PDF 附录页语义对齐）。

### 数据层

- 新迁移：为 `cln_operator_agreement` 增加列（建议）：
  - `hash_draft` VARCHAR(128) NULL — 在首次生成「供签署的 filled PDF」字节流或规范 canonical 文本后写入；
  - `hash_final` VARCHAR(128) NULL — 在最终 PDF 生成完成且内容确定后写入（与 Coliving「无 final hash 可删」对齐时，删除规则优先看 `hash_final` 或保留与 `final_agreement_url` 组合判断，二选一写进实现说明）。
- 若采用「仅存 JSON」方案：在 `signed_meta_json` 内写 `hashDraft`/`hashFinal` 仍须在列表/API 中透出，便于 Portal 与删除规则；**推荐独立列**，与 Coliving 查询模式一致。

### 后端逻辑

- **Draft**：在现有「生成预览 / 进入可签」路径（如 `previewClnAgreementInstancePdfForRecipient` 或首次打开 signing 前的生成点）对 **同一字节序列** 计算 SHA-256（或项目现有 hash 工具），幂等写入 `hash_draft`（已存在则跳过）。
- **Final**：在 `tryFinalizeClnAgreementPdf` 成功写出 `final_agreement_url` 后，对最终文件或合并后 buffer 计算 `hash_final` 并 UPDATE。
- **审计附录**：复用或抽取 [agreement-pdf-appendix.js](src/modules/agreement/agreement-pdf-appendix.js) 中与 CLN 变量兼容的一页（hash_draft、各方签 meta、hash_final）；若 CLN 最终 PDF 纯 Drive 导出，需确认能否在 Node 侧二次合并附录，或改为生成时即带附录（与现有 `generatePdfFromTemplate` 流程对齐 — 实现时选一条稳定路径）。

### 前端

- Agreements 列表或详情：展示 `hash_draft` / `hash_final`（可折叠「审计」区），与 Coliving 操作者心智一致。
- 若 draft 未就绪：状态与 Coliving `draft_pending` 类似时给出「准备 PDF / 重试」入口（与现有 `pending` / `PROFILES_OR_DRAFT_NOT_READY` 语义统一后再接按钮）。

### 删除规则（与 A 统一）

- 以 **`hash_final` 非空** 为硬禁止删除（与 Coliving 一致）；若无列则回退 `final_agreement_url` + `complete`/`signed`。

## 部署

- `npm run build:cleanlemons-portal` + 重启共用 `cleanlemon/next-app/.next` 的 PM2；后端改 `src/**` 重启 Node。

## Todos

- [ ] A: 删除 API + Portal Dialog + `deleteOperatorAgreement`
- [ ] B: 迁移 `hash_draft` / `hash_final`（及索引如需）
- [ ] B: draft/final 写入点与幂等
- [ ] B: 最终 PDF 审计附录（技术路径在实现时定稿）
- [ ] B: Portal 展示 hash + 与 `pending`/签名流文案统一
- [ ] 模板占位 Delete/Edit 处理（可选）
