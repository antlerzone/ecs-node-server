# Available Unit 404 排查

## 已确认

- **app.conf**：`api.colivingjb.com` 的 `location /api/` → `proxy_pass http://127.0.0.1:5000` ✓  
- **本机直连 Node**：`curl -X POST http://127.0.0.1:5000/api/availableunit/list` → **200** ✓  

说明 Node 5000 上的路由正常，Nginx 配置也指向 5000。

## 在 ECS 上再测「经 Nginx + 域名」

在**同一台 ECS** 上执行（走 Nginx + HTTPS）：

```bash
# 经 Nginx、用域名（-k 忽略证书校验，仅测试用）
curl -s -o /dev/null -w "%{http_code}" -X POST https://api.colivingjb.com/api/availableunit/list \
  -H "Content-Type: application/json" \
  -d '{}' \
  -k
```

- 若输出 **200**：说明从 ECS 经 Nginx 到 Node 整条链正常，404 更可能是**浏览器端**（缓存、或前端打错地址）。
- 若输出 **404**：说明 Nginx 或前面还有一层（如 CDN/负载均衡）在返回 404，需要看 Nginx 的 `access.log` / `error.log` 里这条请求有没有进来、被转到哪。

## 若上面 curl 是 200，但浏览器仍 404

1. **清缓存 / 强制刷新**  
   浏览器对 `api.colivingjb.com` 或该请求做强刷（Ctrl+Shift+R 或清空站点数据后再试）。

2. **确认前端请求的 URL**  
   在浏览器 DevTools → Network 里看失败的那条请求，确认：
   - 请求地址是 **`https://api.colivingjb.com/api/availableunit/list`**（无连字符 `available-unit`）；
   - 若仍是 `/api/available-unit/list` 或别的域名，说明跑的是旧前端构建，需要重新 build 并部署 Next，再试。

3. **确认 Next 构建时的环境变量**  
   `coliving/next-app` 里 build 时会把 `NEXT_PUBLIC_ECS_BASE_URL` 打进前端。若未设置或设错，前端可能请求错域名。  
   构建前确认 `.env.local` 或构建环境中有：  
   `NEXT_PUBLIC_ECS_BASE_URL=https://api.colivingjb.com`  
   然后重新执行：  
   `cd coliving/next-app && npm run build && pm2 restart portal-next`

## 可选：重载 Nginx

若改过 Nginx 配置，确保已生效：

```bash
sudo nginx -t && sudo systemctl reload nginx
```
