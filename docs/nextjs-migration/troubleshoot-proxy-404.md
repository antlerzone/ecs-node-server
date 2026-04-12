# Portal 代理 404：access/context/with-client 等

当浏览器出现：

- `POST https://portal.colivingjb.com/api/portal/proxy/access/context/with-client 404 (Not Found)`
- 页面显示 "Access Denied - client not found"

说明 **Next 代理把请求转到了 ECS，但 ECS 返回了 404**。常见原因是：**api.colivingjb.com 实际接到的端口和当前 Node 监听的端口不一致**。

当前推荐用 **server.js** 跑 API（含 companysetting、access 等），且根目录 `.env` 里 **PORT=5000**，即 Node 监听 **5000**。若 Nginx 把 `api.colivingjb.com` 转到了 **3000**，而 3000 上没跑带 `/api/access` 的进程，就会 404。

---

## 办法一：让代理直接打本机 5000（同机部署时）

Portal 和 Node 在同一台 ECS 时，可让 Next 代理不经过 Nginx，直接请求本机 5000：

在 **`docs/nextjs-migration/.env.local`** 里改成：

```bash
# 直接打本机 5000，不经过 api.colivingjb.com
ECS_BASE_URL=http://127.0.0.1:5000
NEXT_PUBLIC_ECS_BASE_URL=https://api.colivingjb.com
```

保留 `NEXT_PUBLIC_USE_PROXY=true`。然后：

```bash
cd /home/ecs-user/app/docs/nextjs-migration && npm run build && pm2 restart portal-next
```

这样 `/api/portal/proxy/*` 会请求 `http://127.0.0.1:5000/api/*`，不再经 Nginx，避免端口对错。

---

## 办法二：改 Nginx，让 api.colivingjb.com 转到 5000

若希望继续用 `https://api.colivingjb.com`（经 Nginx），需要保证 **api.colivingjb.com** 的 `location /api/` 反代到 **5000**（即 server.js 所在端口）。

1. 查当前配置：
   ```bash
   sudo grep -r "api.colivingjb.com\|proxy_pass" /etc/nginx/ 2>/dev/null | head -30
   ```
2. 找到 `server_name` 含 `api.colivingjb.com` 的 server 块，把其中：
   - `proxy_pass http://127.0.0.1:3000;` 改为 `proxy_pass http://127.0.0.1:5000;`
3. 重载 Nginx：
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

---

## 验证

在 ECS 上：

```bash
# 本机 5000 是否有 /api/access（需带 token 会 401，但不应 404）
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:5000/api/access/context/with-client \
  -H "Content-Type: application/json" -d '{"email":"a@b.com","clientId":"x"}'
```

- 返回 **401**：说明路由存在，是鉴权问题（需带 `Authorization`、`X-API-Username`）。
- 返回 **404**：说明 5000 上跑的进程里没有这条路由，需确认 PM2 的 `app` 是否用 **server.js** 启动且已重启。

更完整排查步骤见 [ecs-check-who-serves-api.md](../ecs-check-who-serves-api.md)。

---
