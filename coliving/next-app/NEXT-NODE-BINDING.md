# Next 与 Node 后端绑定说明

Portal（Next.js）通过 **API 代理** 或 **同源 /api** 调用 ECS Node 后端。本地开发与生产部署的绑定方式如下。

## 端口约定

| 服务       | 端口  | 说明 |
|------------|-------|------|
| Node 后端  | 5000  | `npm start` → `server.js`（根目录） |
| Next Portal| 3001  | `npm run start`（coliving/next-app 目录） |
| Next dev   | 3000  | `npm run dev` 默认 3000，可与 Node 5000 同时跑 |

## 本地开发：同时跑 Next + Node

### 1. 启动 Node 后端（根目录）

```bash
cd /home/ecs-user/app
npm start
# 或开发时用 nodemon: npm run dev
# 监听 http://0.0.0.0:5000
```

### 2. 配置 Next 环境变量（coliving/next-app 目录）

复制并编辑 `.env.local`（若不存在则从 `.env.example` 复制）：

```bash
cd coliving/next-app
cp .env.example .env.local
```

**本地绑定 Node 时建议配置：**

```env
# 本地：Next 代理到本机 Node（server.js 5000）
NEXT_PUBLIC_ECS_BASE_URL=http://127.0.0.1:5000
ECS_BASE_URL=http://127.0.0.1:5000

# 使用 Next 代理：浏览器 → /api/portal/proxy → Next 服务端 → Node 5000
NEXT_PUBLIC_USE_PROXY=true

# 同机部署时强制走本机 5000（避免误用公网 API）
FORCE_LOCAL_BACKEND=1

# 受保护接口（如 /api/access/*）需要 ECS 认证
ECS_API_TOKEN=你的token
ECS_API_USERNAME=saas_wix
```

### 3. 启动 Next

```bash
cd coliving/next-app
npm run dev
# 默认 http://localhost:3000
# 或生产模式: npm run build && npm run start  → http://localhost:3001
```

### 4. 验证绑定

- 打开 Portal 登录页，能正常登录即表示 `/api/portal-auth/*` 已通。
- 登录后进入 Tenant/Owner/Operator 任一端，若数据正常加载则 `/api/portal/proxy/*` → Node 5000 已通。

## 请求路径说明

| 场景           | 浏览器请求                         | 实际到达 |
|----------------|------------------------------------|----------|
| NEXT_PUBLIC_USE_PROXY=true | `POST /api/portal/proxy/tenantdashboard/init` | Next 收到 → 服务端请求 `http://127.0.0.1:5000/api/tenantdashboard/init` |
| 登录/注册等   | `POST {ECS_BASE}/api/portal-auth/login`      | 若 ECS_BASE 为公网则直连 api.colivingjb.com；本地开发可设 ECS_BASE 为 http://127.0.0.1:5000（部分页面直连） |

- **Portal 业务 API**（tenantdashboard、ownerportal、agreementsetting 等）：走 **Next 代理** `/api/portal/proxy/*`，由 Next 服务端转发到 `ECS_BASE_URL`（本地即 `http://127.0.0.1:5000`）。
- **Portal 认证**（login、register、forgot-password 等）：部分页面用 `NEXT_PUBLIC_ECS_BASE_URL` 直连后端；本地开发时设为 `http://127.0.0.1:5000` 即可全部走本机 Node。

## 生产部署（同机）

- Node：`server.js` 监听 5000（或通过 `PORT` 指定）。
- Next：build 后 `next start -p 3001`。
- Nginx：  
  - `location /api/portal/proxy/` → `proxy_pass http://127.0.0.1:3001`（进 Next，由 Next 再请求本机 5000）。  
  - `location /`（Portal 页面）→ `proxy_pass http://127.0.0.1:3001`。  
  详见 [docs/nginx-portal-proxy.md](../nginx-portal-proxy.md)。

生产环境 `.env` / `.env.production` 中：

- `ECS_BASE_URL=http://127.0.0.1:5000`（同机时）
- 或 `ECS_BASE_URL=https://api.colivingjb.com`（API 在另一台机时）
- `NEXT_PUBLIC_ECS_BASE_URL` 设为**公网可访问的 API 地址**（如 `https://api.colivingjb.com`），供浏览器直连的登录等请求使用。

## 环境变量速查

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_ECS_BASE_URL` | 浏览器可见；登录/注册等直连 API 的 base URL。本地可填 `http://127.0.0.1:5000`。 |
| `ECS_BASE_URL` | 仅服务端；Next 代理转发时的 ECS 地址。本地同机填 `http://127.0.0.1:5000`。 |
| `NEXT_PUBLIC_USE_PROXY` | `true` 时业务 API 走 `/api/portal/proxy`，推荐保持 `true`。 |
| `FORCE_LOCAL_BACKEND` | `1` 或 `true` 时代理强制用 `http://127.0.0.1:5000`，同机部署时建议开。 |
| `ECS_API_TOKEN` / `ECS_API_USERNAME` | 服务端调用 ECS 受保护接口时的认证，见 `.env.example`。 |

修改 `.env.local` 后需**重启 Next**（`npm run dev` 或 `npm run start`）才会生效。
