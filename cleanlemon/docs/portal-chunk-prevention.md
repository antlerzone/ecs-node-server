# portal.cleanlemons.com：避免 ChunkLoadError / 静态资源 500

## 根因（摘要）

1. **`next build` 后未重启 `next start`（最常见、易忽略）**  
   Next 生产进程在**启动时**会扫描 `.next/static` 并把可访问路径放进内存；**不会在运行中自动刷新**。因此：磁盘上**已经有** `webpack-….js`、`4893-….js` 等文件，`curl` 本机仍可能 **404**，公网也 **404**，直到 **`pm2 restart next-cleanlemons`**（及同 cwd 的其它 Next 进程）。  
   **规则：每次 `next build` 成功后必须立刻重启**所有使用该 `.next` 的 Next 进程。

2. **HTML 与 `.next` 不一致**：缓存的旧 HTML 引用旧哈希；或只重启了 **部分** Next 进程 → **ChunkLoadError** 或 **4xx/5xx**。

3. **双进程同 cwd**：若 PM2 上既有 `next-cleanlemons`（如 3100）又有 `next-cleanlemons-3000`，二者共用 `cleanlemon/next-app/.next`，**只重启其中一个**就会复现问题。

4. **构建器**：生产使用 **`next build --webpack`**（`package.json` 已固定），与 Coliving Portal 一致。

## 自动预防（build 后必重启）

仅写文档无法阻止「只 build 不重启」。本仓库已加 **构建后钩子**（`cleanlemon/next-app/package.json` 的 `build` / `build:low` / `build:lowmem` 在 `next build` 成功后执行 `scripts/pm2-restart-after-build.mjs`）：

- **在 ECS 启用其一即可：**
  1. 一次性：`touch cleanlemon/next-app/.enable-pm2-restart-after-build`（已加入 `.gitignore`，不提交仓库），或  
  2. 环境变量：`RESTART_PM2_AFTER_NEXT_BUILD=1`（`deploy-cleanlemons-portal.sh` 已自动 `export`）。

启用后，每次在该目录执行 `npm run build`（含 `build:low`）会在成功后 **自动 `pm2 restart next-cleanlemons`**（若存在则含 `next-cleanlemons-3000`）。

**本地开发机**不要创建标记文件、也不要设该环境变量，避免误杀本机 PM2。

## 标准部署（推荐）

在仓库根目录 `/home/ecs-user/app`：

```bash
./scripts/deploy-cleanlemons-portal.sh
# 或先拉代码：./scripts/deploy-cleanlemons-portal.sh --pull
# 顺带重启 Cleanlemons API：./scripts/deploy-cleanlemons-portal.sh --all
```

脚本会：`rm -rf cleanlemon/next-app/.next` → `npm install` → `RESTART_PM2_AFTER_NEXT_BUILD=1 npm run build:low` →（build 内已重启 Next）→ 再显式 `pm2 restart` 一遍作为保险。

## Nginx

- `portal.cleanlemons.com` 的 **`location /`** 必须指向 **当前实际使用的** Next 端口（常见 **3100**），与 PM2 配置一致。
- 若曾改端口或增删 PM2 应用，务必核对 **没有** 另一条 `location` 仍指向已停用的上游。

## 发布後自检（可选）

```bash
# 从线上首页抽取 chunk 路径，再测状态码（应为 200）
curl -sI "https://portal.cleanlemons.com/_next/static/chunks/<从HTML复制的hash>.js" | head -3
# 与本机 Next 对比
curl -sI "http://127.0.0.1:3100/_next/static/chunks/<同上>.js" | head -3
```

## 长期建议

- **能合并为一个 Next PM2 进程时尽量合并**，减少「同目录双进程」；在合并前，**发布流程必须重启全部**相关 Next 进程。
- 大版本升级 Next.js 后，按官方 migration 再跑一次完整 **`deploy-cleanlemons-portal.sh`**，并做一次硬刷新验证。
