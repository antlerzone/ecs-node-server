# Agreement PDF：浏览器有空间却报 `storageQuotaExceeded`

## 原因（不是「没权限」）

Node 用 **Google 服务账号**（`GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`）调用 Drive API 执行 `files.copy`。

- 你在浏览器里看到的 **「1.1 MB / 15 GB」** 是 **个人 Google 账号** 的 **「我的云端硬盘」** 配额。
- API 请求的身份是 **`client_email` 对应的服务账号**，配额 **单独计算**。服务账号 **没有** 和个人账号共用的 15GB，常见情况是 **配额为 0 或极小**，因此会返回 **`storageQuotaExceeded`**，与个人盘是否空闲 **无关**。

日志里会打印（部署 `google-docs-pdf.js` 更新后）：

```text
[google-docs-pdf] Drive API caller= SERVICE ACCOUNT client_email=xxx@....iam.gserviceaccount.com | Human "My Drive 15 GB" in browser is NOT this identity — quota is separate.
```

若命中配额错误，还会多一行 **`storageQuotaExceeded diagnosis`** 说明与修复方向。

## 推荐修复

1. **共享云端硬盘（Shared drive / Team Drive）**  
   把 **协议模板 Google Doc** 和 **Folder URL 指向的文件夹** 都放在同一个 **共享盘** 里；把服务账号加为 **内容管理者（Content manager）**。共享盘使用 **组织/共享盘配额**，而不是服务账号个人盘。

2. **Workspace + 网域委派（Domain-wide delegation）**  
   让服务账号 **冒充** 运营邮箱（如 `colivingmanagement@...`）调 Drive，则复制/创建会算在该用户配额下（需管理员配置 OAuth 范围）。

3. **清理**  
   若历史上有大量由服务账号拥有的副本未删，也可能占满 SA 侧可见配额；可在 Drive 搜索 **所有者 = 服务账号邮箱** 并删除（若可见）。

## 代码侧

- 已对 `copy` / `export` / `delete` / `create` / `permissions` / `get` 传入 **`supportsAllDrives: true`**，便于共享盘路径生效。
