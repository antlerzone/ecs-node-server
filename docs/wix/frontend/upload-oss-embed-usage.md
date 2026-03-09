# HTML 上传组件（上传到 OSS）

## 说明

用 **HTML Embed** 替代 Wix Upload Button，使文件上传到阿里云 OSS（`POST /api/upload`），不再使用 Wix 存储。

## 1. HTML 文件

- **文件**：`docs/wix/frontend/upload-oss-embed.html`
- 同一份 HTML 可用于多页（Tenant Dashboard、Owner Portal、Company Setting、Help、Room Setting），由父页面通过 `postMessage` 传入配置（label、accept、uploadId 等）。上传成功时若为视频会回传 `mediaType: 'video'`，否则为图片。

## 2. 在 Wix 编辑器中添加

**Tenant Dashboard 页面**（3 个嵌入）：
- **#htmluploadbuttonfeedback** — 放在 #sectionfeedback，Desktop 尺寸 **449×34**
- **#htmluploadbutton1** — Profile 区，**431×52**，文案：Upload NRIC Front / Passport
- **#htmluploadbutton2** — Profile 区，**431×52**，文案：Upload NRIC Back

**Owner Portal 页面**（2 个嵌入，仅 NRIC）：
- **#htmluploadbutton1** — Profile 区，**431×52**，文案：Upload NRIC Front / Passport
- **#htmluploadbutton2** — Profile 区，**431×52**，文案：Upload NRIC Back

**Company Setting 页面**（1 个嵌入，公司头像）：
- **#htmluploadbuttonprofile** — 放在 #boxprofile 内，Desktop 尺寸建议 **431×52**，文案：Upload company logo / profile photo

**Help 页面**（1 个嵌入，工单附件）：
- **#helpuploadbutton** — 放在 #sectionhelp 内，Desktop 尺寸建议 **449×34** 或 **431×52**，文案：Upload photo or video（accept: image/*,video/*；成功时 postMessage 带 mediaType: 'video'|'image'）

**Room Setting 页面**（2 个嵌入，房间主图与相册）：
- **#htmluploadbutton1** — 房间详情区，**431×52**，文案：Upload main photo（对应 mainPhoto）
- **#htmluploadbutton2** — 房间详情区，**431×52**，文案：Upload gallery images（对应 mediaGallery，可多次上传追加）

**Enquiry 页面**（1 个嵌入，公开页 demo 注册头像）：
- **#htmluploadbuttonprofile** — 放在 #sectiondetail 内，**431×52**，文案：Upload company logo / profile photo。使用 **clientId: 'enquiry'**（无 client 时上传到 OSS `uploads/enquiry/`），JSW 用 `backend/saas/enquiry` 的 `getUploadCreds()`。

嵌入方式二选一：
- **方式 A**：把 `upload-oss-embed.html` 部署到可公网访问的 URL（如 ECS 或 CDN），在 Wix 嵌入组件里设置 **「通过 URL 嵌入」**，填入该 URL。
- **方式 B**：把 `upload-oss-embed.html` 的**完整 HTML 源码**复制，在 Wix 嵌入组件里选择 **「嵌入代码」**，粘贴进去。（若 Wix 对 iframe 有限制，需用可嵌入的 HTML 片段。）

## 3. 前端逻辑（已接好）

- **Tenant Dashboard**：打开 Feedback 时 `initHtmlUploadFeedback()` 向 `#htmluploadbuttonfeedback` 发 `INIT`；打开 Profile 时 `initHtmlUploadProfile()` 向 `#htmluploadbutton1`、`#htmluploadbutton2` 发 `INIT`。clientId 来自当前 tenancy 或第一个 tenancy。
- **Owner Portal**：打开 Profile 时 `initProfileSection()` → `initHtmlUploadProfile()` 向 `#htmluploadbutton1`、`#htmluploadbutton2` 发 `INIT`。clientId 来自 `OWNER.client[0]` 或 `PROPERTIES[0].client_id`。
- **Company Setting**：点击 Edit Profile 打开 #boxprofile 时 `initHtmlUploadProfile()` 向 `#htmluploadbuttonprofile` 发 `INIT`。clientId 来自 `currentClientId`（access 解析出的 client）。上传成功后写入 `profilePhotoUrl` 并刷新 #imageprofile；保存时 `updateProfile({ profilephoto: profilePhotoUrl })`。
- **Help**：打开 Help/Request/Feedback 时 `openHelpMode()` → `initHtmlUploadTicket()` 向 `#helpuploadbutton` 发 `INIT`。clientId 来自 `accessCtx?.client?.id`。上传成功后按 `mediaType` 写入 `ticketPhotoUrl` 或 `ticketVideoUrl`；提交时 `submitTicket({ photo, video, ... })`。
- **Room Setting**：打开房间详情时 `fillDetailSection()` 末尾调用 `initHtmlUploadRoom()` 向 `#htmluploadbutton1`、`#htmluploadbutton2` 发 `INIT`。clientId 来自 `currentClientId`。上传成功后 #htmluploadbutton1 → `roomMainPhotoUrl`，#htmluploadbutton2 → 追加到 `roomMediaGalleryUrls`；保存时 `updateRoom({ mainPhoto: roomMainPhotoUrl || ..., mediaGallery: [...] })`。
- **Enquiry**：进入 #sectiondetail 时 `initHtmlUploadProfile()` 向 `#htmluploadbuttonprofile` 发 `INIT`，clientId 固定为 `'enquiry'`。上传成功后写入 `profilePhotoUrl`，提交时 `submitEnquiry({ profilePhotoUrl, ... })`。
- 鉴权来自 backend **getUploadCreds()**（与 ECS 同套 token/username）。Tenant Dashboard 用 `backend/saas/tenantdashboard`，Owner Portal 用 `backend/saas/ownerportal`，Company Setting 用 `backend/saas/companysetting`，Help 用 `backend/saas/help`，Room Setting 用 `backend/saas/roomsetting`，**Enquiry** 用 `backend/saas/enquiry`。
- 上传成功后 iframe `postMessage` 回 `UPLOAD_SUCCESS`（可选带 `mediaType: 'video'|'image'`），前端把 `url` 写入 feedback 的 photo/video、profile 的 nricFront/nricback、Company Setting 的 profilephoto、Help 工单的 photo/video、或 Room Setting 的 mainPhoto/mediaGallery。

## 4. 后端

- **POST /api/upload** 已存在，无需改 Node；仍为 `multipart/form-data`，字段 `file`、`clientId`，鉴权 `apiAuth`。
- **JSW**：`backend/saas/tenantdashboard.jsw`、`backend/saas/ownerportal.jsw`、`backend/saas/companysetting.jsw`、`backend/saas/help.jsw`、`backend/saas/roomsetting.jsw`、**`backend/saas/enquiry.jsw`** 均提供 `getUploadCreds()`，返回 `{ ok, baseUrl, token, username }`。

## 5. CORS

- 上传时由**浏览器里的 iframe** 直接 `fetch(ECS 的 /api/upload)`，ECS 需允许 Wix 站点所在 origin 的跨域请求（在 Node 的 CORS 配置里加入 Wix 域名，或按需放开）。

## 6. 旧 Upload Button

- **Tenant Dashboard**：可删除 **#uploadbuttonfeedback**、**#uploadbutton1**、**#uploadbutton2**，已改用 HTML 嵌入。
- **Owner Portal**：可删除 **#uploadbutton1**、**#uploadbutton2**，已改用 **#htmluploadbutton1**、**#htmluploadbutton2**。
- **Company Setting**：可删除 **#uploadbuttonprofile**，已改用 **#htmluploadbuttonprofile**。
- **Help**：可删除 **#uploadbutton**，已改用 **#helpuploadbutton**。
- **Room Setting**：可删除 **#uploadbutton1**、**#uploadbutton2**，已改用 **#htmluploadbutton1**、**#htmluploadbutton2**。
- **Enquiry**：使用 **#htmluploadbuttonprofile**（HTML Embed），不用 Wix **#uploadbuttonprofile**；clientId 传 `'enquiry'`。
