# Profile 聯動與 Portal 說明

## 結論：有聯動

同一個 email 的「個人資料」在後端是聯動的：**訪客在任一角色（Tenant / Owner / Staff）改 profile，會透過 `portal_account` 同步到同 email 的 tenant / owner / staff 三張表。**

---

## 後端設計（一個 email = 一份個人資料）

- **`portal_account`**：存一份「會員個人資料」（fullname, phone, address, nric, bankname_id, bankaccount, accountholder）。
- **`tenantdetail`** / **`staffdetail`** / **`ownerdetail`**：各業務表也有對應欄位；同一 email 的列會與 `portal_account` 同步。

核心函數：**`portal-auth.service.js` 的 `updatePortalProfile(email, payload)`**

1. 更新 `portal_account`（該 email 那一列）。
2. 用同一 email 更新三張表：
   - `tenantdetail`：fullname, phone, address, nric, bankname_id, bankaccount, accountholder
   - `staffdetail`：name, bank_name_id, bankaccount
   - `ownerdetail`：ownername, mobilenumber, nric, bankname_id, bankaccount, accountholder

所以：**只要任一處呼叫了 `updatePortalProfile`，同 email 的 tenant / owner / staff 都會一起被更新。**

---

## 誰在什麼時候會觸發聯動

| 入口 | API | 是否聯動 |
|------|-----|----------|
| **Tenant Portal** 改個人資料 | `POST /api/tenantdashboard/update-profile` | ✅ 會。服務裡對 fullname, phone, address, nric, bankName, bankAccount, accountholder 會組 `portalPayload` 並呼叫 `updatePortalProfile`，再寫入 tenantdetail；portal 再同步到 staff/owner。 |
| **Owner Portal** 改個人資料 | `POST /api/ownerportal/update-profile` | ✅ 會。`updateOwnerProfile` 更新 ownerdetail 後，對 ownerName, mobileNumber, nric, bank* 等會呼叫 `updatePortalProfile`，portal 再同步到 tenant/staff。 |
| **Operator：Company Settings → User Setting** 改某 staff 姓名/銀行 | `POST /api/companysetting/staff-update` | ✅ 會。`staff-update` 裡會對該 staff 的 email 呼叫 `updatePortalProfile`，portal 再同步到 tenant/owner。 |
| **直接呼叫 Portal 統一 profile** | `PUT /api/portal-auth/profile`（Bearer JWT） | ✅ 會。只更新 `portal_account` 並同步到三張表；若前端有「統一個人資料」頁面用這個 API，改一次即同步到 tenant/owner/staff。 |

因此：**訪客在 Tenant 或 Owner portal 改個人資料，若該 email 同時是 tenant/owner/staff，會一起被 update；包含透過 portal 的聯動。**

---

## 各 Portal 實際呼叫方式（Next 遷移專案）

- **Tenant**：`lib/tenant-api.ts` → `updateProfile()` → `tenantdashboard/update-profile` → 後端內會呼叫 `updatePortalProfile` ✅  
- **Owner**：`lib/owner-api.ts` → `updateOwnerProfile()` → `ownerportal/update-profile` → 後端內會呼叫 `updatePortalProfile` ✅  
- **Operator「My Profile」頁**：目前用 `getProfile` / `updateProfile`（companysetting），改的是**公司**資料（如公司 logo），不是 staff 個人姓名/銀行。Staff 個人資料是在 **Company Settings → Staff** 裡改，那裡會觸發 `updatePortalProfile`。

### Coliving Next（portal.colivingjb.com）— 統一個人資料頁（2026-03）

- **Tenant / Owner / Operator** 的 `/tenant/profile`、`/owner/profile`、`/operator/profile` 共用 **`docs/nextjs-migration/components/shared/unified-profile-page.tsx`**，**直接**呼叫 **`GET/PUT /api/portal-auth/profile`**（Bearer **`portal_jwt`**），由 `updatePortalProfile` 寫入 `portal_account` 並同步三張 detail 表。
- 封裝：`lib/unified-profile-portal-api.ts`；`portal_jwt` 見 `lib/portal-session.ts`（OAuth callback 與密碼登入 `login` 回傳的 `token`）。
- 與 **Cleanlemons** 側 `unified-profile-page` 布局對齊；Cleanlemons 員工端仍可能經 `cleanlemon` API 轉到同一 `portal_account` 映射。

舊版 tenant/owner 專用大表單若仍呼叫 `tenantdashboard/update-profile` 等，**同樣**會聯動；統一頁則走 **`PUT /api/portal-auth/profile`** 單一路徑。

---

## 小結

- **有聯動**：Tenant / Owner 在各自 portal 改 profile 時，後端會經由 `updatePortalProfile` 寫入 `portal_account` 並同步到同 email 的 tenantdetail、staffdetail、ownerdetail。
- **包含 portal**：上述行為發生在現有 tenant/owner update API 內，等同「透過 portal 改的也會一起 update」。
- **Next Coliving 統一頁**：已改為直接呼叫 **`PUT /api/portal-auth/profile`**（見上節），效果同樣是改一次、三張表一起更新。
