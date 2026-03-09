# 新上传走 OSS、表里已有 URL 保留

## 约定

- **表里已是 URL 的**（如历史 Wix 链接）：**继续保留**，展示时直接用该 URL，无需改库或改逻辑。
- **新上传**：统一走 Node 的 `POST /api/upload`，文件进阿里云 OSS，接口返回可访问 URL，前端把该 URL 存入 feedback / ticket / ownerdetail、以及 **Room Setting 的 mainPhoto / mediaGallery** 等。

## 后端接口（已实现）

- **POST /api/upload**  
  - Content-Type: `multipart/form-data`。**必填字段**：`file`（文件）、`clientId`（当前租户 client 的 id，SaaS 按 client 分目录：`uploads/{clientId}/YYYY/MM/uuid.ext`）。  
  - 需与其它 ECS 接口相同鉴权：`Authorization: Bearer <token>`、`X-API-Username: <username>`。  
  - 成功：`{ ok: true, url: "https://..." }`，该 URL 可写入 DB、直接用于前端展示（签名长期有效）。  
  - 失败：`{ ok: false, reason: "FILE_REQUIRED" | "CLIENT_ID_REQUIRED" | "OSS_UPLOAD_FAILED" | ... }`。

- **GET /api/upload/signed-url?key=xxx**  
  - 若以后表里存的是 OSS key 而非 URL，可用此接口按 key 换取临时签名 URL。当前默认存 URL，可不使用。

## 前端如何上传到 OSS（Wix）

1. **取得鉴权与 baseUrl**  
   在 backend 的 manage.jsw（或已有调用 ECS 的 .jsw）里已有 `ecs_token`、`ecs_username`、`ecs_base_url`。  
   新增一个仅给前端上传用的导出，例如返回 `{ baseUrl, token, username }`（与现有 ECS 调用同一套凭证即可），**不要**把 token 写在前端代码里，由 backend 读 Secret 后返回。

2. **拿到文件并上传**  
   Wix 的 Upload Button 的 `uploadFiles()` 会直接上传到 Wix 并返回 `fileUrl`，**拿不到原始 File 对象**，无法再转发给 ECS。  
   因此「新上传进 OSS」需要能拿到**文件对象**的入口，任选其一：
   - **Tenant Dashboard 已用方案**：在页面放 **HTML Embed**（iframe），内嵌 [upload-oss-embed.html](./frontend/upload-oss-embed.html)，父页 postMessage `INIT`（baseUrl、token、username、clientId、label、accept），嵌入页内用 `<input type="file">` + `fetch(baseUrl + '/api/upload', ...)` 上传，成功后 postMessage `UPLOAD_SUCCESS` 回传 url。JSW 提供 `getUploadCreds()` 取鉴权。详见 [upload-oss-embed-usage.md](./frontend/upload-oss-embed-usage.md)。
   - **通用**：其它页面可复用同一 HTML 或自建 iframe 内嵌 `<input type="file">`，在 Velo 里用 `$w('#html1').onMessage` 接收选中的文件（若 Wix 支持从嵌入传回文件或 base64），再由 backend 请求 ECS `/api/upload`；或使用能提供 **File / Blob** 的 Wix 组件（若有），在 **frontend** 用 `fetch(baseUrl + '/api/upload', ...)`，其中 `formData.append('file', file)`。

3. **写入表时仍用 URL 字符串**  
   - feedback：`photo` / `video` 存接口返回的 `url`。  
   - ticket：`photo` / `video` 存接口返回的 `url`。  
   - ownerdetail：`nricfront` / `nricback` 存接口返回的 `url`。  
   - **Room Setting**：用 HTML Embed **#htmluploadbutton1**（主图）、**#htmluploadbutton2**（相册），打开房间详情时 `initHtmlUploadRoom()` 发 INIT，上传成功后写入 `roomMainPhotoUrl` / 追加 `roomMediaGalleryUrls`，保存时 `updateRoom({ mainPhoto, mediaGallery })`。JSW 提供 `getUploadCreds()`。详见 [upload-oss-embed-usage.md](./frontend/upload-oss-embed-usage.md)。  
   展示时：若字段是 URL 就直接用（历史 Wix URL 或新 OSS 签名 URL 均可），无需区分来源。

## 小结

- 表里**已有 URL 的图片/视频**：逻辑不改，继续保留、直接使用。  
- **新上传**：前端把文件 POST 到 `POST /api/upload`，拿返回的 `url` 写入对应表；文件实际落在 OSS，表里只存 URL。
