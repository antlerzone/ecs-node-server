# 一步一步查：谁在接 api.colivingjb.com

在 ECS 上按下面顺序执行，用你本机的终端（SSH 到 ECS 后）即可。

---

## 步骤 1：看根路径返回什么（判断 app.js 还是 server.js）

在 ECS 上执行：

```bash
curl -s https://api.colivingjb.com/
```

看输出：

- 若是 **`Launch Advisor Backend Running 🚀`**（一行字）→ 接的是 **app.js**
- 若是 **`{"ok":true,"message":"server running"}`**（JSON）→ 接的是 **server.js**

记下结果（app.js 还是 server.js）。

---

## 步骤 2：看本机有哪些 Node 进程在跑

在 ECS 上执行：

```bash
ps aux | grep node
```

看有没有 `node app.js`、`node server.js` 或 `node .../app.js` 等。记下 **PID**（第二列）和 **命令**（最后一列或最后几列）。

若用了 **pm2**，再执行：

```bash
pm2 list
```

记下每个 app 的 **name**、**script**（是 app.js 还是 server.js）、**status**。

---

## 步骤 3：看 3000、5000 端口是谁在听

在 ECS 上执行：

```bash
sudo lsof -i :3000
sudo lsof -i :5000
```

或（没有 lsof 时）：

```bash
ss -tlnp | grep -E ':3000|:5000'
```

或：

```bash
sudo netstat -tlnp | grep -E ':3000|:5000'
```

看 **PID** 和 **程序名**（例如 node）。  
对照步骤 2 的进程列表，确认：

- **3000** 一般是 **app.js**（若在跑）
- **5000** 一般是 **server.js**（若在跑）

记下：api 域名最后会反代到哪一个端口（见步骤 4）。

---

## 步骤 4：看 nginx 把 api.colivingjb.com 转到哪个端口（若有 nginx）

在 ECS 上执行：

```bash
sudo nginx -t
```

若报错「command not found」或没 nginx，**跳过步骤 4**，结论就是：公网直接连到某端口的 Node（看步骤 1 和 3）。

若有 nginx，再执行：

```bash
sudo grep -r "api.colivingjb.com\|colivingjb" /etc/nginx/ 2>/dev/null || sudo grep -r "api.colivingjb.com\|colivingjb" /usr/local/nginx/conf/ 2>/dev/null
```

或直接看默认站点配置：

```bash
sudo cat /etc/nginx/nginx.conf
sudo ls /etc/nginx/conf.d/
sudo cat /etc/nginx/conf.d/*.conf
```

在配置里找 **server_name** 含 `api.colivingjb.com` 的 **server** 块，再看里面的 **proxy_pass** 或 **upstream**，例如：

- `proxy_pass http://127.0.0.1:3000;` → 接的是 **3000 端口**
- `proxy_pass http://127.0.0.1:5000;` → 接的是 **5000 端口**

记下：**api.colivingjb.com 被转到 3000 还是 5000**。

---

## 步骤 5：对一下结论

把前面结果对起来：

| 步骤 1 根路径返回 | 步骤 4 反代端口（或直接访问的端口） | 结论 |
|------------------|-------------------------------------|------|
| Launch Advisor... | 3000 | 当前是 **app.js** 在接；若 POST /api/access/context 仍 404，多半是进程没重启、代码旧。 |
| Launch Advisor... | 5000 | 矛盾（5000 一般是 server.js），可能是 5000 也跑了 app.js，或 nginx 配置和实际不一致，以步骤 1 为准。 |
| {"ok":true,...}   | 5000 | 当前是 **server.js** 在接；POST /api/access/context 要带 token，或改 nginx 指到跑 app.js 的 3000。 |
| {"ok":true,...}   | 3000 | 3000 上跑的是 server.js（或混用），需确认 3000 的启动命令。 |

- 若希望 **Wix 用 access 且不鉴权**：应让 **api.colivingjb.com → 指向跑 app.js 的端口**（并确保 app.js 已重启、含 access 路由）。
- 若希望继续用 server.js：则 Wix 的 ecs_token / ecs_username 必须正确，且 POST 会校验鉴权。

---

## 步骤 6：确认 POST /api/access/context 是否可用

在 ECS 上执行：

```bash
curl -s -X POST "https://api.colivingjb.com/api/access/context" \
  -H "Content-Type: application/json" \
  -d '{"email":"starcity.shs@gmail.com"}'
```

- 若返回 **JSON**（例如 `{"ok":false,"reason":"NO_STAFF"}`）→ 路由已通，按 reason 在 MySQL 里排查即可。
- 若返回 **HTML 且写 `Cannot POST /api/access/context`** → 当前接域的进程里没有这条路由，需按上面结论改成用 **app.js** 接 api.colivingjb.com 并重启。

---

## 小结

1. **步骤 1**：`curl -s https://api.colivingjb.com/` → 看是 app.js 还是 server.js。
2. **步骤 2**：`ps aux | grep node`、`pm2 list` → 看跑的是哪些脚本。
3. **步骤 3**：`lsof -i :3000`、`lsof -i :5000` → 看 3000/5000 是谁。
4. **步骤 4**：nginx 配置里找 api.colivingjb.com 的 `proxy_pass` → 看转到哪一端口。
5. **步骤 5**：对一下「谁在接 api.colivingjb.com」。
6. **步骤 6**：再 curl POST /api/access/context 确认是否返回 JSON。
