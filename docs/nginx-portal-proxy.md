# Nginx：portal.colivingjb.com 的 API 請求

## 使用 Next proxy（NEXT_PUBLIC_USE_PROXY=true）時

Portal 請求 `portal.colivingjb.com/api/portal/proxy/tenantdashboard/...`。此路徑**必須**進 **Next.js (3001)**，否則會回 403/404 HTML。

若目前有 `location /api/` 轉到 Node (3000)，請在**之前**加上更具體的 location：

```nginx
server {
    server_name portal.colivingjb.com;
    # ... ssl 等設定 ...

    # 必須：/api/portal/proxy 進 Next.js（proxy 轉發到 ECS）
    # 上傳協議模板等需放寬 body 大小，預設 1m 會 413
    # 預覽 PDF（LibreOffice）可能需 1–2 分鐘，避免 504 請加大 proxy_read_timeout
    location /api/portal/proxy/ {
        client_max_body_size 20m;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # 公開房源頁 API（Available Unit 列表，無登入）
    location /api/available-unit/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # 其他 /api 可轉 Node（若有需要）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        # ...
    }
    # 頁面轉到 Next.js
    location / {
        proxy_pass http://127.0.0.1:3001;
        # ...
    }
}
```

**重點**：`location /api/portal/proxy/` 必須在 `location /api/` **之前**，且指向 3001。

### 若 SaaS Admin「API Docs」或其它 proxy 請求回 404

若瀏覽器請求 `POST https://portal.colivingjb.com/api/portal/proxy/billing/indoor-admin/api-docs-users` 得到 **404**，代表該請求**沒有進到 Next.js**，而是被 Nginx 的 `location /api/` 轉到了 Node（或其它後端）。Node 的路由是 `/api/billing/...`，沒有 `/api/portal/proxy/...`，故回 404。

**處理方式**：在 **portal.colivingjb.com** 的 server 區塊內，確保有 **`location /api/portal/proxy/`**，且必須寫在 **`location /api/`** 的**前面**（Nginx 先匹配更長、更具體的 location），並指向 Next.js（例如 `proxy_pass http://127.0.0.1:3001;`）。改完執行 `sudo nginx -t && sudo systemctl reload nginx`，並確認 Portal 已 build 且重啟（`pm2 restart portal-next`）。

### Company Settings 上傳 Logo / 章（chop）回 404

Next 代理會把 `POST /api/portal/proxy/upload` 與 `.../upload/chop` 轉到後端 **`/api/upload`**、**`/api/upload/chop`**。生產入口是 **`server.js`**（`npm start`），必須掛載 `upload` 路由（與 `app.js` 一致）。若後端未掛載 `/api/upload`，代理會收到 **404**。另：若 Nginx 誤把 `/api/portal/proxy/upload` 轉到 Node 而非 Next，`server.js` 內 **`/api/portal/proxy/upload`** 的 fallback 可同一路由處理。

## 其他選項

- **NEXT_PUBLIC_USE_SAME_ORIGIN_API=true**：Portal 請求 `portal.colivingjb.com/api/...`，Nginx 需把 portal 的 `/api` 轉到 Node (3000)。
- **直接調用 api.colivingjb.com**：設 `NEXT_PUBLIC_USE_SAME_ORIGIN_API=false` 且 `NEXT_PUBLIC_USE_PROXY=false`，需 api.colivingjb.com 的 CORS 允許 portal.colivingjb.com。

## 驗證

改完後執行：

```bash
sudo nginx -t && sudo systemctl reload nginx
cd /home/ecs-user/app/coliving/next-app && npm run build && pm2 restart portal-next
```

再從 Portal 試一次 Change PIN。若 proxy 正常，`pm2 log app` 應出現 `[tenantdashboard] passcode-save hit`。
