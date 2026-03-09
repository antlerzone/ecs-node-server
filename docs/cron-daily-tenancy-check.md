# 每日租约欠租检查定时任务（自助配置）

接口 **`POST /api/cron/daily-tenancy-check`** 会在每天被调用一次，用于检查「到期未付租金」的租约并执行封锁（TTLock 密码过期、断电、`active=0`）。

**需要你自己**在服务器或云上配置定时触发，在 **每天 00:00（UTC+8）** 调用该接口一次。

---

## 1. 可选：设置密钥

在 `.env` 里设置：

```env
CRON_SECRET=你的随机密钥
```

设置后，请求必须带以下之一才会执行逻辑：

- Header：`X-Cron-Secret: 你的随机密钥`
- 或 Body JSON：`{ "secret": "你的随机密钥" }`

不设置 `CRON_SECRET` 时，不校验密钥（仅建议在内网或已用其他方式保护时使用）。

---

## 2. 用系统 cron（Linux / ECS）

在 crontab 里加一行（每天 00:00 马来西亚时间 = 16:00 UTC 前一天，或 00:00 用服务器本地时区）：

```bash
# 每天 00:00 执行（请按你服务器时区调整，例如 Asia/Kuala_Lumpur）
0 0 * * * curl -X POST -H "Content-Type: application/json" -H "X-Cron-Secret: 你的CRON_SECRET" https://你的域名/api/cron/daily-tenancy-check
```

若 ECS 在内网，可把 `https://你的域名` 换成内网地址或 `http://localhost:5000`（端口按你实际）。

---

## 3. 用 AWS EventBridge (CloudWatch Events)

1. 打开 **EventBridge** → **Rules** → **Create rule**。
2. **Schedule**：Cron 表达式（UTC）  
   - 每天 00:00 马来西亚时间 = **16:00 UTC 前一天**，例如：`cron(0 16 * * ? *)`  
   - 或若用 Singapore (UTC+8)：`cron(0 0 * * ? *)` 表示 UTC 00:00，即 08:00 新加坡；若要新加坡 00:00 则用 `cron(0 16 * * ? *)`（UTC 16:00 = 新加坡 00:00）。
3. **Target**：**API Gateway** 或 **Lambda**。  
   - 若用 Lambda：在 Lambda 里发 `POST` 到你的 ECS/ALB 的 `https://你的域名/api/cron/daily-tenancy-check`，并带上 `X-Cron-Secret`（若已设）。
4. 保存并启用规则。

---

## 4. 用其他云或脚本

只要能在 **每天 00:00 UTC+8** 发一条 **POST** 请求到：

- URL：`https://你的域名/api/cron/daily-tenancy-check`
- 可选 Header：`X-Cron-Secret: <CRON_SECRET>`

即可。例如用 Azure Functions、Google Cloud Scheduler、或一台固定机器上的 cron + curl 都可以。

---

## 5. 手动测试

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Cron-Secret: 你的密钥" https://你的域名/api/cron/daily-tenancy-check
```

成功时返回 JSON 含 `ok: true` 和 `processed` 等字段。
