# ECS 上执行：client_wixid → client_id 回填 + account_client 回填

列名统一使用 **client_id**，不用 `client`。

## 前提

1. 已跑迁移 **0052_account_client_junction.sql**（建好 `account_client` 表）。
2. 在 ECS 上进入项目目录后再执行下面命令。

## 一键粘贴（ECS 上执行）

```bash
cd /home/ecs-user/app && node scripts/account-backfill-client-id-and-junction.js
```

## 分步（可选）

```bash
cd /home/ecs-user/app
```

```bash
node scripts/account-backfill-client-id-and-junction.js
```

## 脚本做了什么

1. **第一层 junction**：用 `account.client_wixid` 回填 `account.client_id`（按 `clientdetail.wix_id` 匹配得到 `clientdetail.id` 写入 `client_id`）。
2. **第二层**：从 `account.account_json` 读出每条映射，把其中的 `clientId`/wix_id 解析成 `client_id`，写入 `account_client`（列名均为 `client_id`）。

若未建 `account_client` 表，脚本会提示先执行 0052 迁移，再重新运行本脚本。
