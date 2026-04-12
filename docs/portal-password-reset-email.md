# Portal 忘記密碼：驗證碼 Email 如何發出

## 網站在 Wix、網域在 Wix，如何開通 SMTP？

- **Wix 只負責網站與網域**，不提供「用你網域發信」的 SMTP 帳號，也沒有像 cPanel 那種內建郵件主機。所以要發信（例如忘記密碼驗證碼），必須用**第三方發信服務**。
- **開通方式兩種思路：**

| 方式 | 要不要動 Wix / DNS | 發件人顯示 | 適合 |
|------|---------------------|------------|------|
| **用 Gmail 當 SMTP** | 不用，馬上能用 | 例如 `colivingmanagement@gmail.com` | 先上線、測試、小量 |
| **用 SendGrid 等 + 驗證網域** | 要在 Wix 加一筆 DNS | 例如 `noreply@colivingjb.com` | 想用自己網域發信、較正式 |

下面分別說明如何開通。

---

## 目前狀況（程式端）

- **預設行為：ECS 沒有真的發信。**  
  程式只會把驗證碼寫進 DB（`portal_password_reset`），並在 Node 日誌裡打一行：  
  `[portal-password-reset] Code for 用戶@email.com : 123456`  
  所以用戶**收不到**驗證碼郵件，除非你到 ECS 上看 `pm2 logs app` 把 code 抄下來手動告訴用戶（或自己填在 Reset password 頁）。

- **要讓用戶真的收到 email**，需要：  
  1. **「開通」一種發信管道**（見下方選項）  
  2. 在 ECS 的 **`.env`** 裡設定對應的環境變數  
  3. 安裝依賴並重啟 Node（若用 SMTP + nodemailer，見下方）

---

## 發信由誰發、用哪個 Email？

- **「發件人」地址**：由你設定的 **`PORTAL_RESET_FROM_EMAIL`** 決定（例如 `noreply@colivingjb.com` 或 `colivingmanagement@gmail.com`）。  
  用戶收到的信會顯示「寄件人」是這個地址。

- **「用哪個 email」**：  
  - 若用 **Gmail SMTP**：就是某一個 Gmail 帳號（例如 `starcity.shs@gmail.com`），需在該帳號開啟「應用程式密碼」或「低安全性應用程式存取」。  
  - 若用 **SendGrid / AWS SES / 其他 SMTP**：通常是該服務提供的發信地址或你驗證過的網域（例如 `noreply@你的網域.com`）。

- **收件人**：就是用戶在 Forgot password 頁填的 **email**（例如 `starcity.shs@gmail.com`），驗證碼會發到這個信箱。

---

## 選項一：用 Gmail 當 SMTP（適合測試）

1. 用一個 Gmail 帳號當發信帳號（例如 `colivingmanagement@gmail.com`）。  
2. 在該 Gmail：  
   - [Google 帳戶](https://myaccount.google.com/) → 安全性 → **兩步驟驗證** 先開啟；  
   - 再在 **應用程式密碼** 裡為「郵件」新增一組密碼（約 16 字元）。  
3. 在 ECS 的 `.env` 設定（把 `你的gmail@gmail.com`、`應用程式密碼` 換成實際值）：

```env
# 發件人顯示名稱與信箱（用戶看到的「誰寄的」）
PORTAL_RESET_FROM_NAME=Coliving Management
PORTAL_RESET_FROM_EMAIL=你的gmail@gmail.com

# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=你的gmail@gmail.com
SMTP_PASS=應用程式密碼
```

4. 安裝依賴並重啟：

```bash
cd /home/ecs-user/app
npm install nodemailer
pm2 restart app
```

之後點「Send verification code」就會真的從該 Gmail 發信到用戶填的 email。

---

## 選項二：SendGrid / AWS SES / 其他 SMTP

- **SendGrid**：在 [SendGrid](https://sendgrid.com/) 註冊，建立 API Key 或 SMTP 憑證，並在 SendGrid 驗證發信網域或單一 email。  
  - 若用 SMTP：在 `.env` 設 `SMTP_HOST=smtp.sendgrid.net`、`SMTP_PORT=587`、`SMTP_USER=apikey`、`SMTP_PASS=你的SendGrid_API_Key`，`PORTAL_RESET_FROM_EMAIL` 設成你在 SendGrid 驗證過的發信地址。

- **AWS SES**：在 AWS 開通 SES，驗證發信 domain 或 email，取得 SMTP 憑證（或用 AWS SDK，需另寫一層）。  
  - 若用 SES SMTP：在 `.env` 設 `SMTP_HOST=email-smtp.xx-x-x.amazonaws.com`、`SMTP_PORT=587`、`SMTP_USER` / `SMTP_PASS` 用 SES 的 SMTP 憑證，`PORTAL_RESET_FROM_EMAIL` 設成 SES 驗證過的地址。

- **其他 SMTP**：只要主機支援 SMTP（例如公司信箱、cPanel 郵件），把對應的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS` 和 `PORTAL_RESET_FROM_EMAIL` 設好即可。

---

## 網域在 Wix：用 SendGrid 開通「自己網域」發信（選做）

若你想用 **noreply@colivingjb.com** 這類「自己網域」當發件人，且網域 DNS 在 Wix 管理，可以這樣開通 SendGrid：

1. **註冊 SendGrid**  
   - 到 [SendGrid](https://sendgrid.com/) 註冊帳號（有免費額度，例如每月約 100 封）。

2. **在 SendGrid 新增並驗證網域**  
   - 後台：Settings → Sender Authentication → **Domain Authentication** → Add New。  
   - 輸入你的網域（例如 `colivingjb.com`），SendGrid 會給你幾筆 **DNS 紀錄**（CNAME，例如 `em1234.colivingjb.com` → `u1234567.wl.sendgrid.net`）。

3. **在 Wix 加上面那幾筆 DNS**  
   - 登入 Wix → 網站/網域 → 選你的網域（例如 colivingjb.com）→ **管理 DNS** 或 **進階 DNS**。  
   - 新增 SendGrid 要求的那幾筆 **CNAME**（主機名稱、指向 SendGrid 給你的值），儲存。

4. **回 SendGrid 按「驗證」**  
   - DNS 傳播可能要幾分鐘到幾小時，完成後在 SendGrid 按 Verify，狀態變為 Verified 即可。

5. **建立 API Key（當 SMTP 密碼用）**  
   - SendGrid：Settings → API Keys → Create API Key，權限選 Mail Send，複製產生的 Key（只顯示一次）。

6. **在 ECS 的 `.env` 設定**（發件人用你剛驗證的網域底下的信箱）：

```env
PORTAL_RESET_FROM_NAME=Coliving Management
PORTAL_RESET_FROM_EMAIL=noreply@colivingjb.com

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=你的SendGrid_API_Key
```

7. ECS 上 `npm install nodemailer`、`pm2 restart app`，即可用「自己網域」發信。

**小結**：Wix 只負責「把 SendGrid 給的 CNAME 加進網域 DNS」；真正開通發信的是 SendGrid，SMTP 設定在 ECS 的 `.env`。

---

## 環境變數總覽

| 變數 | 必填 | 說明 |
|------|------|------|
| **PORTAL_RESET_FROM_EMAIL** | 發信時必填 | 發件人 email（用戶看到的「寄件人」） |
| **PORTAL_RESET_FROM_NAME** | 選填 | 發件人顯示名稱（例如 "Coliving Management"） |
| **SMTP_HOST** | 發信時必填 | SMTP 主機（如 smtp.gmail.com） |
| **SMTP_PORT** | 發信時必填 | 通常 587（TLS）或 465（SSL） |
| **SMTP_SECURE** | 選填 | 若 port 465 設為 `true` |
| **SMTP_USER** | 發信時必填 | SMTP 登入帳號 |
| **SMTP_PASS** | 發信時必填 | SMTP 登入密碼或應用程式密碼 |

**若以上 SMTP / FROM 變數都沒設**：行為與現在一樣，只打 log、不發信，用戶收不到驗證碼。

---

## 如何確認有沒有發信？

在 ECS 上看 Node 日誌（`pm2 logs app`），找 **`[portal-password-reset]`** 這行：

| 日誌內容 | 代表 |
|----------|------|
| `Email sent to xxx@email.com` | **有發信**；若收件箱沒有，到垃圾郵件找。 |
| `Code for xxx : 123456 (no SMTP configured; ...)` | **沒發信**，程式沒讀到 SMTP 設定。 |
| `Send failed: ...` | 有嘗試發信但 SMTP 失敗（帳密、連線等）。 |

若出現 **no SMTP configured**，通常有兩種可能：

1. **ECS 上的 `.env` 沒有 SMTP 變數**  
   `.env` 多半不會進 git，若你只在本地改過，要**在 ECS 的 `/home/ecs-user/app/.env` 手動補上** PORTAL_RESET_FROM_* 與 SMTP_* 那幾行。

2. **PM2 沒有重新載入 .env**  
   只執行 `pm2 restart app` 不會重讀 `.env`，要改成：
   ```bash
   pm2 restart app --update-env
   ```
   再試一次 Forgot password，看日誌是否變成 `Email sent to ...`。

---

## 程式位置

- 發信邏輯：`src/modules/portal-auth/portal-password-reset-sender.js`  
- 呼叫處：`portal-auth.service.js` 的 `requestPasswordReset()`（寫入 `portal_password_reset` 後呼叫 `sendPasswordResetCode(email, code)`）。

若你要改用 **AWS SES SDK** 或 **SendGrid API** 而不是 SMTP，可改寫 `portal-password-reset-sender.js` 的 `sendPasswordResetCode`，只要介面保持 `(email, code)` 即可。
