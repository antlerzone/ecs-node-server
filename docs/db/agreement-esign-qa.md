# Agreement e-sign：资料齐全、员工/公司章、hash 字段说明

## 1) 如何判断「双方资料齐全」？

**结论：** 不按「双方」逐项检查，而是按 **agreement 的 mode** 用**同一套 context 构建逻辑**判断：能成功建出该 mode 的 PDF 所需 context，即视为资料齐全。

### 实现位置

- **`agreement.service.js` → `isAgreementDataComplete(agreementId)`**
  - 根据 agreement 的 `mode` 调用对应的 context 函数（与生成 PDF 时相同）：
    - **tenant_operator**：`getTenantAgreementContext(tenancy_id, template_id, staffVars)`  
      → 需要：tenancy、tenant、room、property、client（及 template）都存在且可查。
    - **owner_operator**：`getOwnerAgreementContext(owner_id, property_id, client_id, template_id, staffVars)`  
      → 需要：owner、property、client、template 都存在且可查。
    - **owner_tenant**：`getOwnerTenantAgreementContext(tenancy_id, template_id, staffVars)`  
      → 需要：tenancy、tenant、owner、room、property、client、template 都存在且可查。
  - 若对应 context 返回 `ok: true`，则 **资料齐全**；否则返回 `ok: false` 和 `reason`（如 `tenant_not_found`、`missing_tenancy_id` 等）。

### 资料齐全 ≠ 逐项勾选

- 没有「业主填完、租客填完、运营方填完」的独立勾选表。
- **资料齐全** = 上述 context 所需的主数据（tenancy / tenant / owner / room / property / client）在 DB 里存在且关联正确，context 能一次性建成功。
- 前端在合适时机（如业主/租客资料已填完）调 **POST /api/agreement/is-data-complete**；若 `ok` 再调 **prepare-for-signature** 生成 PDF。

### 三种 mode 对应「齐全」含义（与文档一致）

| mode           | 参与方       | 资料齐全 = context 能成功构建所需数据 |
|----------------|--------------|----------------------------------------|
| owner_tenant   | 业主 + 租客  | tenancy + tenant + owner + room + property + client |
| tenant_operator| 租客 + 运营方| tenancy + tenant + room + property + client |
| owner_operator | 业主 + 运营方| owner + property + client |

---

## 2) 员工代表公司签名：staff 姓名 + 公司章（chop）从哪来？

### 员工姓名 / 签字（staffdetail + staffname）

- **签名区里的「员工」信息**（如 `{{staffname}}`、`{{operatorsign}}`）来自**当前登录员工**，不是固定写死在模板里。
- 流程：
  - 前端打开合约时带 **access context**（当前登录用户）。
  - 若为 staff，则从 **staffdetail** 取该员工的 `name`、`email`、`nric`、`mobilenumber` 等，组成 **staffVars**（如 `staffname`、`staffemail`、`staffnric`、`staffcontact`）。
  - 调 **tenant-context / owner-context** 等 API 时把 **staffVars** 传入；agreement.service 把 staffVars 写进 context.variables，模板里的 `{{staffname}}` 等被替换。
  - **operatorsign**：员工在 Admin Dashboard 签名时，前端把签名图片（如 base64 / wix:image URL）传给 **operator-sign** API，写入 `agreement.operatorsign`；生成 PDF 或渲染 HTML 时用该值替换 `{{operatorsign}}`。
- **结论：** 员工代表公司时，**姓名等来自 staffdetail（当前登录员工），签字来自该员工在页面上签的 operatorsign**。不是从 companysetting 里单独再填一份「签约人姓名」。

### 公司章（chop）

- 模板和 PDF 生成支持 **`{{clientchop}}`** 占位符（见 `google-docs-pdf.js` 的 `IMAGE_PLACEHOLDERS`，含 `clientchop`）。
- **当前实现：** agreement 的 context 里**没有**从 companysetting / client_profile / clientdetail 读「公司章图片」并赋给 `clientchop`。也就是说：
  - 若模板里写了 `{{clientchop}}`，而 context 未提供该变量，则生成 PDF 时该处会是空或占位图。
- **若要让公司章来自 companysetting：**
  - 需要在 **companysetting（公司资料）** 里增加「公司章图片」的录入与存储（例如 client_profile 或 clientdetail 新字段/JSON 字段存图片 URL 或 base64）。
  - 在 **agreement.service** 的 `getTenantAgreementContext`、`getOwnerAgreementContext`、`getOwnerTenantAgreementContext` 中，根据 client 取到该公司章图片，放入 `variables.clientchop`（与 `operatorsign` 等一样，为图片 URL 或 wix:image 格式），这样生成 PDF/HTML 时才会把「公司在 companysetting 填的章」打上去。

**简短结论：**  
- **员工姓名/签字**：来自 **staffdetail + 当前登录员工在页面的签名（operatorsign）**。  
- **公司章**：模板支持 `{{clientchop}}`，但**目前没有**从 companysetting 读入并写入 context；要「公司章在 companysetting 填」需要新增公司章存储 + 在 agreement context 里提供 `clientchop`。

---

## 3) hash document & hash final document 如何标记？agreement 表是否多了几列？

**结论：** 是在 **agreement 表里新增列** 来标记的，不是用别的表。

### Migration

- **`0053_agreement_hash_draft_final_version.sql`** 给 **agreement** 表增加了三列：
  - **hash_draft** `varchar(64)`：生成「待签署版」Draft PDF 时算出的文档 hash，代表「当前这份可签的文档」的版本。
  - **hash_final** `varchar(64)`：双方（或所有参与方）签完后，生成 Final PDF 时算出的文档 hash（当前流程文档里写「未在本阶段实现」）。
  - **version** `int NOT NULL DEFAULT 1`：文档版本号，生成签署版时设为 1。

### 何时写入

- **hash_draft**：在 **prepareAgreementForSignature(agreementId)** 里，当资料齐全并成功调用 `generatePdfFromTemplate` 生成 Draft PDF 后，用返回的 `result.hash` 写入 `agreement.hash_draft`，同时写入 `url`/`pdfurl`、`version=1`、`status=ready_for_signature`。
- **hash_final**：文档约定在「双方签完后」生成 Final PDF 时写入；当前代码里若未实现「签完生成 Final PDF」的流程，则 `hash_final` 会一直为 NULL。
- **version**：在 prepare-for-signature 时设为 1；若将来支持「重新生成签署版」，可再递增。

### 状态与 repeater

- 只有 `status IN ('ready_for_signature','locked','completed')` 且 `(url IS NOT NULL OR pdfurl IS NOT NULL)` 的 agreement 才会在 repeater 中显示并可签。
- 签名时（后续实现）应校验当前 PDF 的 hash 与 **hash_draft** 一致，并可选记录 signed_hash、timestamp 等。

**简短结论：**  
- **hash document** = agreement 表的 **hash_draft** 列（Draft PDF 的 hash）。  
- **hash final document** = agreement 表的 **hash_final** 列（Final PDF 的 hash，双方签完后生成）。  
- 都是 **agreement 表新增的 column**，由 migration 0053 添加。

---

## 4) 签名时记录 IP 地址

- **场景**：ECS 可能被 apps/webbrowser 或其它代理调用，需记录「签名请求」的客户端 IP。
- **实现**：
  - **Migration 0054_agreement_signed_ip.sql**：agreement 表增加 `operator_signed_ip`、`tenant_signed_ip`、`owner_signed_ip`（varchar(45)）。
  - **src/utils/requestIp.js**：`getClientIp(req)` 优先读 `X-Forwarded-For`（取第一个 IP）、其次 `X-Real-IP`、再 `req.ip` / `req.connection.remoteAddress`。
  - **Operator 签**：POST /api/admindashboard/agreement/operator-sign 在更新 `operatorsign` 时同时写入 `operator_signed_ip`。
  - **Tenant 签**：POST /api/tenantdashboard/agreement-update-sign 在更新 `tenantsign` 时同时写入 `tenant_signed_ip`。
  - **Owner 签**：POST /api/ownerportal/agreement-update-sign 在更新 `ownersign` 时同时写入 `owner_signed_ip`。
