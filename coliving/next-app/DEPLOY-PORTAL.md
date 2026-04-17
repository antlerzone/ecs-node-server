# Portal 部署（ECS）

## 快速部署（推薦）

在專案根目錄 `/home/ecs-user/app` 執行：

```bash
./scripts/deploy-portal.sh
```

或先拉代碼再部署：

```bash
./scripts/deploy-portal.sh --pull
```

若後端 (Node API) 也有更新，一併重啟：

```bash
./scripts/deploy-portal.sh --pull --all
```

## 手動步驟

```bash
cd /home/ecs-user/app/coliving/next-app
npm install
npm run build
pm2 restart portal-next
```

本專案前端以 `npm` 為準（使用 `package-lock.json`），避免混用 `pnpm` 造成依賴版本漂移。

若曾出現 `next: command not found`，先在本目錄執行 `npm install` 再 build。

若 build 被 OOM kill，可試：`npm run build:min`（512MB）或先 `pm2 stop portal-next` 再 build。

## 僅重啟後端 API（無前端變更時）

```bash
pm2 restart app
```

## 502 Bad Gateway（portal 調後端時）

若 portal 與 Node API 在同一台 ECS 上，proxy 預設會打 `http://127.0.0.1:3000`，不經 nginx，可避免 502。  
若 portal 與 API 在不同機器，在 `coliving/next-app/.env.local` 設：

```
ECS_BASE_URL=https://api.colivingjb.com
```

然後重啟 portal：`pm2 restart portal-next`。

## 環境變數

若要在 portal 上**強制不顯示** Demo Credentials，build 前在 `coliving/next-app` 目錄新增或編輯 `.env.local`：

```
NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=false
```

然後再執行部署指令。
