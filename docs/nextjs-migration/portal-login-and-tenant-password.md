# Portal 登入與租客密碼

## 1) 點 Tenant Portal 後回到 /login 的原因與修復

- **原因**：登入頁目前只寫入 `localStorage["user"]`，沒有寫入 **`portal_member`**。  
  `/tenant` 的 layout 用 `useAuth("tenant")`，而 useAuth 是讀 **`getMember()`**（即 `portal_member`）。  
  沒有 `portal_member` → 被視為未登入 → 重定向到 `/login`。

- **修復**：在 `app/login/login-form.tsx` 的登入成功流程裡，除了寫 `localStorage["user"]` 外，**同時呼叫 `setMember({ email, roles })`**，把同一組 email 與 roles 寫入 `portal_member`。  
  這樣從 /portal 點 Tenant Portal 進入 /tenant 時，useAuth 能讀到 member，就不會再被導回登入頁。

- **注意**：目前仍是 **mock 登入**（任意 email+密碼都會過）。若要改為後端驗證，需在登入時呼叫 `getMemberRoles(email)`（或未來的登入 API），並用後端回傳的 `roles` 呼叫 `setMember(...)`。

---

## 2) 租客密碼設定記錄在哪裡？Table？

依目前架構有兩種「密碼」：

| 用途 | 記錄位置 | 說明 |
|------|----------|------|
| **Portal 登入（email + 密碼）** | 目前**沒有**獨立 table 存租客登入密碼 | `getMemberRoles` 只依 **email** 在 `tenantdetail`（及 staffdetail/ownerdetail/clientdetail）查身份，不驗證密碼。若未來要做「租客設定登入密碼」，需新增欄位或表（例如 `tenantdetail.password_hash` 或獨立 account 表）並在登入 API 驗證。 |
| **租客門鎖 PIN（Smart Door）** | **`tenancy`** 表 | 欄位：`password`、`passwordid`（TTLock 等）。用於租客門鎖密碼/PIN，與 Portal 登入密碼無關。 |

- **tenantdetail**：存租客資料（email、姓名、電話、銀行等），**沒有** `password` / `password_hash` 欄位（見 `0001_init.sql`）。
- **tenancy**：存租約與門鎖相關的 `password`、`passwordid`。
- **api_user**：存 API 用戶的 `password_hash`，非租客 Portal 登入用。

結論：**租客「登入用」密碼目前沒有 table 記錄**；**門鎖 PIN** 在 **tenancy** 表。

---

## 3) 是不是什麼密碼都可以登入？

**目前是。**  
Portal 登入頁是 **mock 登入**：只檢查有填 email 和密碼就當成功，沒有呼叫後端驗證，也沒有讀寫任何密碼欄位。所以**隨便一組密碼都可以「登入」**，只差在後端 `getMemberRoles(email)` 會依 **email** 判斷這個人有沒有 tenant/owner/operator 等身份；若 email 不在 tenantdetail 等表裡，選 Tenant Portal 後可能沒有資料或 API 回錯。  
若要正式環境安全，必須改成**真實登入**（見下一節）。

---

## 4) 之前 Wix 用 Google 登入，可以嗎？

**可以。**  
在 Wix 時是用 **Wix Members / wixUsers**：使用者用 Wix 提供的登入（可能是 Email+密碼或 **Google 登入**，由 Wix 後台設定），登入後前端用 `wixUsers.currentUser.getEmail()` 拿到 email，再呼叫 `tenantDashboardInit()` 等 API。也就是說：**誰能登入、用什麼方式登入（含 Google）都是 Wix 負責的**，我們只拿 email。

遷到 Next（portal.colivingjb.com）後，Wix 不再負責登入，所以要自己接一種登入方式，常見兩種：

| 方式 | 說明 |
|------|------|
| **Google 登入（OAuth）** | 用 **NextAuth.js** 或類似套件，加 **Google Provider**。使用者點「用 Google 登入」→ 跳 Google → 回傳後取得 **email**，再呼叫後端 `getMemberRoles(email)`，若 `registered` 且 `roles.length > 0` 就 `setMember({ email, roles })` 並跳 `/portal`。**不需要**在 DB 存密碼，只認「這個 email 是 Google 驗證過的」且存在 tenantdetail 等表。 |
| **Email + 密碼** | 在 DB 新增存密碼（例如 `tenantdetail.password_hash` 或獨立 account 表），登入時送 email+密碼給後端，後端驗證 hash 並回傳 roles，再 `setMember`。 |

若你們在 Wix 時是用 Google 登入，在 Next 上接 **Google OAuth** 最接近原本體驗；後端仍只需 `getMemberRoles(email)`，不用新增密碼欄位。

---

## 5) 和 Wix 一樣：Google / Facebook + 手動註冊，用 email 辨識同一人

### 要支援的登入方式

- **Google 登入**、**Facebook 登入**
- **手動註冊 / 登入**（email + 密碼，Sign up & Sign in）

不是每個顧客都有 Google/Facebook，所以一定要有手動註冊；同時有 OAuth 給有 Google/Facebook 的人用。

### 我們自己要不要記錄？

只記錄**手動註冊**的密碼：

- **手動註冊**：顧客用 email + 密碼 Sign up → 在 DB 存 **email + password_hash**（例如新表 `portal_account`），才能驗證「用密碼登入」。
- **Google / Facebook**：不用在 DB 存「這人用 Google 登入」。登入時只做：用 OAuth 取得**已驗證的 email** → 呼叫 `getMemberRoles(email)`，若該 email 在 tenantdetail / staffdetail / ownerdetail / clientdetail 就有身份 → 放行並 `setMember({ email, roles })`。

所以：**只有手動註冊需要我們記錄（email + password_hash）**；Google/Facebook 只當「幫我們驗證這個 email」的管道。

### 用 email 辨識 → 手動註冊 vs Google 看到同一筆資料

身份一律用 **email**：`getMemberRoles(email)` 依 email 查 tenantdetail 等表，同一個 email = 同一個人 = 同一筆資料。

例子：顧客 **xxx@gmail.com** 先**手動註冊**（Sign up 填 xxx@gmail.com + 密碼）→ 我們在 `portal_account` 存 (xxx@gmail.com, password_hash)，且該 email 已在 tenantdetail。之後他用 **Google 登入**，Google 回傳的也是 **xxx@gmail.com** → `getMemberRoles("xxx@gmail.com")` 回傳同一個 tenant → 看到的房、合約、繳費等**會一樣**。

結論：可接受 Google/Facebook auth；我們只記錄手動註冊的帳密（如 `portal_account`）；用 email verify；Manual 註冊可以（Sign up & Sign in）；同一 email 不管手動還是 Google 登入，看到的資料會一樣。

---

## 6) 已實作：portal_account 表 + 註冊／登入 API（草稿）

- **Migration**：`src/db/migrations/0083_portal_account.sql`  
  - 表 `portal_account`：`id`, `email` (unique), `password_hash`, `created_at`, `updated_at`。  
  - 執行方式（在專案根目錄，會讀取 `.env` 的 DB_*）：  
    `node scripts/run-migration.js src/db/migrations/0083_portal_account.sql`

- **後端**  
  - **Service**：`src/modules/portal-auth/portal-auth.service.js`  
    - `register(email, password)`：僅當 `getMemberRoles(email).registered === true` 才可註冊（該 email 已在 tenantdetail / staffdetail / ownerdetail / clientdetail）；寫入 `portal_account`，密碼用 bcrypt hash。  
    - `login(email, password)`：查 `portal_account` 驗證密碼，成功後回傳 `getMemberRoles(email)` 的 `email` + `roles`。  
  - **Routes**：`src/modules/portal-auth/portal-auth.routes.js`  
    - `POST /api/portal-auth/register` body: `{ email, password }`  
    - `POST /api/portal-auth/login` body: `{ email, password }`  
  - 已在 `app.js` 掛載 `app.use('/api/portal-auth', portalAuthRoutes)`，並在 CORS 加入 `https://portal.colivingjb.com`、`https://demo.colivingjb.com`。

- **前端**（Next 登入／註冊頁）待接：  
  - 註冊：呼叫 `POST /api/portal-auth/register`，若 `ok` 則導向登入或直接 setMember+跳 /portal（若後端在註冊時也回傳 roles 可一併登入）。  
  - 登入：呼叫 `POST /api/portal-auth/login`，若 `ok` 則 `setMember({ email, roles })` 並 `router.push('/portal')`；若 `reason === 'INVALID_CREDENTIALS'` 顯示帳密錯誤。

---

## 5) 和 Wix 一樣：Google / Facebook + 手動註冊，用 email 辨識同一人

### 要支援的登入方式（與 Wix 對齊）

- **Google 登入**
- **Facebook 登入**
- **手動註冊 / 登入**（email + 密碼，Sign up & Sign in）

不是每個顧客都有 Google/Facebook，所以**一定要有手動註冊**；同時有 OAuth 給有 Google/Facebook 的人用。

### 我們自己要不要記錄？

要，但只記錄**手動註冊**的密碼：

- **手動註冊**：顧客用 email + 密碼 Sign up → 我們要在 DB 存這組「可登入」的帳號，也就是要有一個地方存 **email + password_hash**（例如新表 `portal_account`），否則無法驗證「用密碼登入」的人。
- **Google / Facebook**：不用在我們 DB 存「這個人是用 Google 登入的」。登入時只做兩件事：
  1. 用 OAuth 向 Google/Facebook 取得**已驗證的 email**
  2. 用這個 email 呼叫後端 `getMemberRoles(email)`，若該 email 在 tenantdetail / staffdetail / ownerdetail / clientdetail 裡就有身份 → 放行並 `setMember({ email, roles })`

所以：**只有「手動註冊」需要我們自己記錄（email + password_hash）**；Google/Facebook 只當成「幫我們驗證這個 email 是誰」的管道，不必在我們 DB 多存一筆「登入方式」。

### 用 email 辨識同一人 → 手動註冊 vs Google 看到同一筆資料

身份一律用 **email** 辨識：

- 後端 `getMemberRoles(email)` 是依 **email** 查 tenantdetail、staffdetail、ownerdetail、clientdetail，回傳這個 email 有哪些身份（tenant / owner / operator / saas_admin）。
- 所以：**同一個 email = 同一個人 = 同一筆資料**，不管他是用手動登入還是 Google 登入。

例子：

- 顧客 **xxx@gmail.com** 先**手動註冊**（Sign up 填 xxx@gmail.com + 密碼）→ 我們在 `portal_account` 存 (xxx@gmail.com, password_hash)，且這個 email 已在 tenantdetail（營運端已建好租客）。
- 之後他改用 **Google 登入**，Google 回傳的 email 也是 **xxx@gmail.com**。
- 登入流程：取得 email → `getMemberRoles("xxx@gmail.com")` → 回傳同一個 tenant 身份 → `setMember({ email, roles })`。
- 所以他用「手動帳密」登入，和用「Google 戶口 xxx@gmail.com」登入，**看到的會是同一筆資料**（同一個 tenant、同一間房、同一份合約與繳費等）。

結論：  
- **可以接受 Google / Facebook auth**，和 Wix 一樣。  
- **我們自己只需要記錄「手動註冊」的帳密**（例如 `portal_account`：email + password_hash）。  
- **用 email 來 verify**：手動註冊用「我們存的密碼」驗證；Google/Facebook 用「OAuth 回傳的 email」驗證。  
- **Manual 註冊可以**：Sign up & Sign in 用 email + 密碼，寫入並驗證 `portal_account`。  
- **同一人（同一 email）不管用手動還是 Google 登入，看到的資料會一樣**，因為後端只看 email。
