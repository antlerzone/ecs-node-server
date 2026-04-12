# Agreement template preview – Node (Google API) → OSS

流程：**把协议做成 Google Docs 文档放在 Drive** → 在 Agreement Setting 填 **该 Doc 的链接** + **Drive 文件夹链接**。保存后 ECS 后台用 **Node + Google Docs/Drive API**（与正式合约 PDF 相同栈）：复制母版 → 用样本变量替换占位符（预览用红色高亮）→ 导出 PDF → **上传到阿里云 OSS**，数据库写入 **`agreementtemplate.preview_pdf_oss_url`**。Operator 点 Preview 时由 `POST /api/agreementsetting/preview-pdf-download` 优先从 **OSS** 取；若无缓存则现场生成。

**部分文档**（例如从 Word 导入、结构特殊的 Doc）会在 `docs.documents.batchUpdate` 报错：`This operation is not supported for this document`。此时预览会自动 **回退**：`Drive files.export` 导出 HTML → 在内存中替换占位符（红字）→ **Puppeteer** 转 PDF，不再依赖 Docs 的 `replaceAllText`。正式 `prepare-for-signature` / 最终 PDF 若仍走复制+`batchUpdate`，遇同类文档可能仍需在 Google Docs 里 **文件 → 另存为纯 Google 文档** 或新建空白 Doc 再粘贴内容。

## 前置条件

- **Operator**：Company Settings 中连接 **Google Drive**（OAuth refresh token 存 MySQL），且模板 Doc + 目标 Folder 对该 Google 账号可访问；或  
- **平台**：配置 `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`，且 Doc/Folder 已与服务账号共享（Shared drive 等见运维说明）。

未配置凭证时，`preview_pdf_status` 会变为 `failed`，错误信息提示连接 Drive 或配置服务账号。

## 可选：`AGREEMENT_PREVIEW_TEMP_FOLDER_ID`

生成「仅预览、不落客户 folder 的 PDF 缓冲」时，临时副本可放在服务账号 Drive 下某文件夹，减轻客户 folder 配额压力。见代码 `google-docs-pdf.js` 中 `getPreviewCopyParentFolderId`。

## HTML 字段（`generate-html`）

不再使用 Apps Script。`POST /api/agreementsetting/generate-html` 通过 **Drive API `files.export`（`text/html`）** 拉取 Doc HTML 并写入 `agreementtemplate.html`。

## 相关接口

| 时机 | 行为 |
|------|------|
| create/update 且同时有 templateurl + folderurl | `preview_pdf_status=pending`，后台生成 PDF → 上传 OSS → `ready` |
| 再次保存（Doc + 文件夹齐全） | 重新生成并更新 OSS |

## 已移除

- Google Apps Script Web App（`AGREEMENT_PREVIEW_GAS_URL`、`AGREEMENT_HTML_GAS_URL`、`AGREEMENT_GAS_ENDPOINT`）
- `POST /api/agreement/callback`（GAS 回写 PDF URL）

合约 PDF 的 `request-pdf` 现 **仅** 走 Node；无 Google 凭证时返回 `GOOGLE_CREDENTIALS_REQUIRED`。
