# Nginx：讓 /api/portal-auth 的請求進到 Node（解決 CORS preflight）

## 問題

瀏覽器從 `https://portal.colivingjb.com` 打 `https://api.colivingjb.com/api/portal-auth/register` 時會先發 **OPTIONS**（preflight），再發 **POST**。  
若日誌裡**完全沒有** `[CORS debug]`、`[portal-auth]`，代表 **OPTIONS 與 POST 都沒進到 Node**，而是被 Nginx（或前層代理）處理或擋掉了。

---

## 快速修復：Nginx 直接回應 OPTIONS + CORS（推薦）

若目前 **OPTIONS 根本沒進到 Node**（例如沒有 `location /api/` 轉發，或 OPTIONS 被別處擋掉），可在 **api.colivingjb.com** 的 server 裡加上下面這段，讓 Nginx 自己對 OPTIONS 回 204 並帶 CORS 頭，**POST 照樣轉發到 Node**：

```nginx
location /api/ {
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, x-request-id, X-Request-Id' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Max-Age' 86400;
        add_header 'Content-Length' 0;
        return 204;
    }
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- 上面 `$http_origin` 會帶上瀏覽器發的 Origin（例如 `https://portal.colivingjb.com`），preflight 通過後瀏覽器才會發 POST。
- 若希望只允許特定來源，可把 `$http_origin` 改成固定值，例如：  
  `add_header 'Access-Control-Allow-Origin' 'https://portal.colivingjb.com' always;`

改完後執行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

再從 portal 試一次註冊；POST 會打到 Node，Node 日誌應會出現 `[portal-auth] POST /register`。

---

## 做法（讓 OPTIONS 也進 Node）

請在 **api.colivingjb.com** 對應的 Nginx server 裡，把 `/api/` 轉發到 Node（例如 `http://127.0.0.1:3000`），並**不要**對 OPTIONS 回 4xx/5xx，要讓 OPTIONS 也進到 Node，由 Node 回 204 + CORS 頭。

### 範例一：已有 location /api/

若你已經有：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

請確認 **沒有** 單獨對 `$request_method = OPTIONS` 回 404/405 的設定，且上面這段會處理 **所有** 到 `/api/` 的請求（含 OPTIONS）。這樣 OPTIONS 會進 Node，Node 會回 204 和 `Access-Control-Allow-Origin` 等頭。

### 範例二：OPTIONS 轉給 Node（由 Node 回 CORS）

若你希望 OPTIONS 也進 Node，由 Node 回 204 + CORS，只要確保有 `location /api/` 且**不要**在 Nginx 裡對 OPTIONS 做 `return 204`，例如：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
}
```

改完後執行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

然後再從 portal 試一次註冊；同時看 Node 日誌應會出現 `[CORS debug]` 和 `[portal-auth] POST /register received`。

---

## Finverse Link 的 CORS（x-request-id）

從 **link.prod.finverse.net**（Finverse Link iframe）打 `GET https://api.colivingjb.com/api/finverse/callback?...` 時，瀏覽器會帶自定義頭 `x-request-id`，預檢時 Nginx 必須在 `Access-Control-Allow-Headers` 裡允許該頭，否則會報「Request header field x-request-id is not allowed」。

若 Nginx 在 server 內對 `location /api/` 的 **OPTIONS** 直接回 204，請把 `Access-Control-Allow-Headers` 設為包含 `x-request-id`，例如：

`'Content-Type, Authorization, x-request-id, X-Request-Id'`

參考本目錄 `nginx-app-api-location.conf`。改完後 `sudo nginx -t && sudo systemctl reload nginx`。
