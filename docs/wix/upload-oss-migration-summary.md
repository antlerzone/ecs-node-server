# OSS 上传迁移总结（Wix Upload Button → HTML Embed）

## 背景

- **目标**：新上传文件统一走阿里云 OSS（`POST /api/upload`），不再使用 Wix 存储。
- **限制**：Wix Upload Button 的 `uploadFiles()` 直接上传到 Wix，拿不到 `File` 对象，无法转发到 ECS。
- **方案**：用 **HTML Embed** 内嵌同一份 `upload-oss-embed.html`，父页面通过 `postMessage` 发 `INIT`（baseUrl、token、username、clientId、label、accept），iframe 内用 `<input type="file">` + `fetch(POST /api/upload)` 上传，成功后 `postMessage` 回 `UPLOAD_SUCCESS`（含 url，可选 mediaType）。

---

## 已迁移页面一览

| 页面 | 原 Wix 组件 | 现 HTML Embed ID | 用途 | JSW getUploadCreds |
|------|--------------|------------------|------|--------------------|
| **Tenant Dashboard** | #uploadbuttonfeedback, #uploadbutton1, #uploadbutton2 | #htmluploadbuttonfeedback, #htmluploadbutton1, #htmluploadbutton2 | 反馈图/视频、NRIC 正/背面 | tenantdashboard.jsw |
| **Owner Portal** | #uploadbutton1, #uploadbutton2 | #htmluploadbutton1, #htmluploadbutton2 | NRIC 正/背面 | ownerportal.jsw |
| **Company Setting** | #uploadbuttonprofile | #htmluploadbuttonprofile | 公司头像 | companysetting.jsw |
| **Help** | #uploadbutton | #helpuploadbutton | 工单 photo/video（mediaType 区分） | help.jsw |
| **Room Setting** | #uploadbutton1, #uploadbutton2 | #htmluploadbutton1, #htmluploadbutton2 | 房间主图 mainPhoto、相册 mediaGallery | roomsetting.jsw |

---

## 共用资源

- **HTML 文件**：`docs/wix/frontend/upload-oss-embed.html`  
  - 成功时回传 `UPLOAD_SUCCESS`，带 `url`；若为视频则带 `mediaType: 'video'`，否则为图片。
- **后端**：`POST /api/upload`（multipart/form-data：file、clientId；鉴权 apiAuth）已存在，未改 Node。
- **JSW**：上述 5 个页面对应的 `backend/saas/*.jsw` 均新增 **getUploadCreds()**，返回 `{ ok, baseUrl, token, username }`（与 ECS 同套凭证）。
- **文档**：  
  - 使用说明与 Wix 编辑器配置：[upload-oss-embed-usage.md](./frontend/upload-oss-embed-usage.md)  
  - 前端上传约定：[upload-oss-frontend.md](./upload-oss-frontend.md)

---

## 各页要点

- **Tenant Dashboard**：Feedback 区 init #htmluploadbuttonfeedback；Profile 区 init #htmluploadbutton1/2；clientId 来自 tenancy；保存 feedback 用 feedbackUploadUrls，保存 profile 用 profileNricFrontUrl/profileNricBackUrl。
- **Owner Portal**：打开 Profile 时 initHtmlUploadProfile()，clientId 来自 OWNER.client[0] 或 PROPERTIES[0].client_id；上传成功直接 updateOwnerProfile({ nricFront/nricback: url }) 并刷新 #imagenric1/#imagenric2。
- **Company Setting**：打开 #boxprofile 时 initHtmlUploadProfile()，clientId 为 currentClientId；上传写入 profilePhotoUrl，保存时 updateProfile({ profilephoto: profilePhotoUrl })。
- **Help**：打开 Help/Request/Feedback 时 initHtmlUploadTicket()，clientId 为 accessCtx?.client?.id；按 mediaType 写 ticketPhotoUrl/ticketVideoUrl，提交时 submitTicket({ photo, video, ... })。
- **Room Setting**：打开房间详情 fillDetailSection() 末尾 initHtmlUploadRoom()，clientId 为 currentClientId；#htmluploadbutton1 → roomMainPhotoUrl，#htmluploadbutton2 → 追加 roomMediaGalleryUrls；保存时 updateRoom({ mainPhoto, mediaGallery })。

---

## 未迁移 / 无需迁移

- **Property Setting**：仅有未使用的 `uploadIfAny(uploadButtonId)` 辅助函数，无实际 Upload 组件；若日后加上传再按本方案接 HTML Embed。

---

## 其他修改（同周期）

- **JSW 类型**：companysetting 的 `updateAccountingEinvoice(opts)` 将 `opts` 改为可选 `[opts]` 且 `provider?`/`einvoice?`，消除 `{}` 缺属性报错；roomsetting 的 `errBody` 用 `/** @type {{ reason?: string } | null } */ (await res.json())` 消除 “Property 'reason' does not exist on type 'object'”。
- **文档**：README、docs/index.md、docs/readme/index.md 中已补充 OSS/embed/getUploadCreds、每日 cron 门锁电量写 feedback、各页上传与 Help/Room Setting 说明。
