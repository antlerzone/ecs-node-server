# Xendit Webhook 配置说明

**背景**：Operator 可能在新加坡 (SGD) 或马来西亚 (MYR)；**SAAS 为马来西亚公司**。**Xendit 产品支持新加坡与马来西亚**（SGD/MYR、PayNow、卡等）。当前我们产品规则：仅 **马来西亚 Operator** 可选 Xendit；新加坡 Operator 使用 Stripe。

## 需要配置的 Webhook

我们只用 **Xendit Invoice API** 收款，因此只需在 Xendit Dashboard 里配置 **INVOICES** 的 Webhook。

### 1. Webhook URL

在 Xendit Dashboard → **Developers** → **Webhooks**（或 Callbacks）中：

- **Product**: **INVOICES**
- **Invoices paid**（发票已支付）  
  填写：`https://<你的 API 域名>/api/payex/callback`

例如：

- 生产：`https://api.yourdomain.com/api/payex/callback`
- 本地/测试：`https://your-ngrok-or-domain/api/payex/callback`

后端使用的 callback 基址来自环境变量 `API_BASE_URL` 或 `PUBLIC_APP_URL`，必须与 Xendit 里填的域名一致（且为公网可访问）。

### 2. 可选勾选（INVOICES 下）

- **Also notify when an invoice has expired**  
  可选。过期时我们目前只记 reference，不强制需要。
- **Also notify when a payment has been received after expiry**  
  可选。若需要“过期后仍收款”的通知可勾选。

### 3. Webhook verification token

Xendit 的 “Webhook verification token” 会随每次 webhook 请求发送。**当前后端未做该 token 校验**，你可先在 Dashboard 里设一个备用，后续若要防伪造再在后端校验。

### 4. 其他 Product（FVA、Disbursement、Cards 等）

若只使用 Invoice 收款，**不必**配置 FVA、Disbursement、Cards、Payment Requests 等其它产品的 Webhook。

### 5. Test / Live

- **Test 模式**：在 Xendit Dashboard 的 **Test** 环境下配置上述 **Invoices paid** URL。
- **Live 模式**：在 **Live** 环境下再配同样 URL（或对应生产域名）。

两套环境的 callback 路径相同：`/api/payex/callback`。

## 密钥说明（Operator 子账号 vs 平台 SAAS）

- **Portal 公司设置（operator/company）**：每个 operator 必须使用 **自己 Xendit 子账号** 的 API keys，在此页注册子账号并填写 Test/Live Secret Key。**不要使用平台（SAAS）主账号的 key。**
- **Test**：填该 operator 子账号的 **Test** Secret Key（`xnd_development_...`），并勾选 “Use test mode”。
- **Live**：填该 operator 子账号的 **Live** Secret Key（`xnd_production_...`），不勾选 test mode。
- **Public key**：当前后端未使用。勿把 **Secret Key** 提交到代码库或写在文档里。

---

## 若 Webhook 测试返回 502 / 404（api.colivingjb.com）

1. **Nginx**：`api.colivingjb.com` 的 `location /api/` 必须反向代理到 **运行 Node API 的端口**（如 5000）。若当前指向 3000（例如 Next.js），需改为 5000：
   - 找到 api.colivingjb.com 的 server 配置（如 `/etc/nginx/conf.d/` 下），把 `location /api/` 里的 `proxy_pass http://127.0.0.1:3000;` 改为 `proxy_pass http://127.0.0.1:5000;`
   - 执行 `sudo nginx -t` 后 `sudo systemctl reload nginx`
2. **PM2**：确保监听 5000 端口的进程在运行（如 `pm2 list` 里 status 为 online）。若当前 `app` 跑的是 `app.js`，已在该应用内挂载 `/api/payex`，只要进程不 errored 即可。若进程反复崩溃，用 `pm2 logs app --lines 100` 查错并修好后再测。
3. **自测**：在服务器上执行  
   `curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:5000/api/payex/callback -H "Content-Type: application/json" -d '{}'`  
   应返回 200 及 JSON；再测公网  
   `curl -s -o /dev/null -w "%{http_code}" -X POST https://api.colivingjb.com/api/payex/callback -H "Content-Type: application/json" -d '{}'`  
   也应为 200。
