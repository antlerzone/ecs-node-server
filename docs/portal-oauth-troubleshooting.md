# Portal Google / Facebook 登入排查

當 Google 或 Facebook 登入「突然」不可用時，按下面順序檢查。

---

## 0. 404 + "client not found"（必須先排除）

若點「Sign in with Google」或「Sign in with Facebook」後，請求回傳 **404**、body 為 `{"ok":false,"message":"client not found"}`，代表請求有進到 **Node**，但被 **clientresolver** 擋下（用 Host 的 subdomain 查 clients 表，api.colivingjb.com 的 subdomain 是 `api`，沒有對應 client）。

**處理：**

1. **確認程式已更新並重啟**  
   - 本庫的 `src/middleware/clientresolver.js` 已對 `/api/portal-auth`、`/api/access` 放行（不查 client）。  
   - 在 ECS 上執行：`git pull`（或部署最新程式）→ 然後 **`pm2 restart app`**（或你實際的 Node 進程名）。  
   - 未重啟則仍會跑舊版 clientresolver，繼續回 404。

2. **驗證是否放行**  
   重啟後再試一次 Google/Facebook 登入，並看 Node 日誌：
   ```bash
   pm2 logs app --lines 30
   ```
   若請求有被放行，應會出現：`[clientresolver] skip portal-auth, path= /api/portal-auth/google`（或 `/facebook`）。  
   若沒有這行且仍是 404，代表跑的仍是舊程式或路徑與預期不符。

3. **本機直連 Node 測試**（可選）  
   在 ECS 上執行：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api/portal-auth/google" -H "Host: api.colivingjb.com"
   ```
   - 若回 **302**（重定向到 Google）或 **302 到 login?error=OAUTH_NOT_CONFIGURED** → clientresolver 已放行，OAuth 有進到 portal-auth。  
   - 若回 **404** → 目前跑的 Node 仍會對該 Host 回 client not found，請再確認程式與重啟。

---

## 1. 看登入頁 / 彈窗回傳的錯誤

登入失敗後，登入頁或彈窗會帶 `?error=...`，對應含義：

| error 參數 | 含義 | 處理方向 |
|-----------|------|----------|
| **OAUTH_NOT_CONFIGURED** | 後端未設定 OAuth 環境變數 | 檢查 ECS/Node 的 `.env`：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 或 `FACEBOOK_APP_ID`、`FACEBOOK_APP_SECRET` 是否有值 |
| **OAUTH_ERROR** | 後端或 Passport 拋錯（如網路、callback URL 錯誤） | 看 Node 日誌 `[portal-auth] google callback error:` 或 `facebook callback error:` |
| **OAUTH_FAILED** | 一般 OAuth 失敗 | 看 Node 日誌 `[portal-auth] google/facebook callback no user, reason:` |
| **EMAIL_NOT_REGISTERED** | 該 Google/Facebook 的 **email 尚未在系統內** | 該 email 必須存在於 `tenantdetail` / `staffdetail` / `ownerdetail` / `clientdetail` / `saasadmin` 任一表，否則不允許建立 portal 帳號；先用「手動註冊」或由後台把該 email 加入對應表 |
| **NO_EMAIL** | Google/Facebook 未回傳 email（權限或設定問題） | 檢查 Google/Facebook 應用是否申請並取得 email scope；Facebook 開發模式可能限制回傳 email |

---

## 2. 環境變數（Node 後端）

在跑 Portal 後端的那台機器（例如 ECS）上確認：

| 變數 | 說明 |
|------|------|
| **GOOGLE_CLIENT_ID** / **GOOGLE_CLIENT_SECRET** | Google OAuth 2.0 憑證（Google Cloud Console → APIs & Services → Credentials） |
| **FACEBOOK_APP_ID** / **FACEBOOK_APP_SECRET** | Facebook 應用憑證（Facebook for Developers → 應用 → 設定 → 基本） |
| **PORTAL_AUTH_BASE_URL** | **必須** 是 API 的對外網址（例如 `https://api.colivingjb.com`），**不要** 尾隨斜線。Google/Facebook 會把使用者導回 `PORTAL_AUTH_BASE_URL/api/portal-auth/google/callback` 或 `.../facebook/callback`，若這裡設錯或為空，callback 會失敗 |
| **PORTAL_FRONTEND_URL** | 登入成功/失敗後要跳轉的 Portal 前端（例如 `https://portal.colivingjb.com`） |

若 `PORTAL_AUTH_BASE_URL` 為空，Passport 的 `callbackURL` 會變成相對路徑，Google/Facebook 導回時會錯。

---

## 3. Google / Facebook 後台「授權的重新導向 URI」

必須與後端實際使用的 **callback URL** 完全一致（含 protocol、domain、path）：

- Google：**Google Cloud Console** → 你的 OAuth 2.0 用戶端 ID → **授權的重新導向 URI** 中要有  
  `https://api.colivingjb.com/api/portal-auth/google/callback`  
  （若你的 API 網址不同，改成對應的 `PORTAL_AUTH_BASE_URL + /api/portal-auth/google/callback`）
- Facebook：**Facebook for Developers** → 你的應用 → **Facebook 登入** → **設定** → **有效的 OAuth 重新導向 URI** 中要有  
  `https://api.colivingjb.com/api/portal-auth/facebook/callback`

若最近改過 API 網域、從 http 改 https、或改過 path，這裡沒跟著改就會「突然」登入不到。

---

## 4. EMAIL_NOT_REGISTERED：誰可以 OAuth 登入？

後端邏輯：**只有「已註冊」的 email 才能用 Google/Facebook 登入**。

- 「已註冊」= 該 email 在下列任一表存在（由 `getMemberRoles` 查）：`tenantdetail`、`staffdetail`、`ownerdetail`、`clientdetail`、`saasadmin`。
- 若 Google/Facebook 回傳的 email **不在** 上述任一表 → 回傳 `EMAIL_NOT_REGISTERED`，登入頁會顯示「This account is not in our system. Please register first.」

處理方式：

- 讓使用者先用 **email + 密碼註冊**（會寫入 `portal_account`，且該 email 須已在上述某表），或  
- 由後台在 **tenantdetail / staffdetail / ownerdetail / clientdetail / saasadmin** 中新增或補上該 email，之後再用 Google/Facebook 登入即可。

---

## 5. 看 Node 日誌

在 ECS（或跑 Node 的機器）上：

```bash
# 若用 pm2
pm2 logs --lines 200
```

點一次 Google 或 Facebook 登入後，找：

- `[portal-auth] google callback error:` 或 `facebook callback error:` → 代表 Passport/DB 拋錯。
- `[portal-auth] google callback no user, reason: EMAIL_NOT_REGISTERED`（或 `NO_EMAIL`、`OAUTH_FAILED` 等）→ 代表 OAuth 成功但後端拒絕登入，原因在 `reason`。

根據 `reason` 對照上面表格處理。

---

## 6. 常見「突然壞掉」原因整理

1. **PORTAL_AUTH_BASE_URL 被改或沒設** → callback 網址錯，Google/Facebook 導回失敗或 404。
2. **Google/Facebook 後台「重新導向 URI」沒更新** → 例如 API 從 `http` 改 `https` 或換 domain 後，沒在兩邊後台改 URI。
3. **環境變數沒帶進行程** → 部署或重啟後 `.env` 沒載入，`GOOGLE_*` / `FACEBOOK_*` 為空 → 會導到 `OAUTH_NOT_CONFIGURED`。
4. **該 email 被從系統移除** → 例如從 staffdetail 刪除或改 email，就會變成 `EMAIL_NOT_REGISTERED`。

先確認登入頁或彈窗回傳的 `?error=` 值，再對照本文件與 Node 日誌即可縮小範圍。
