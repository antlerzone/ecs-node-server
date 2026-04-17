# Tenant Dashboard 功能對照表（Wix vs Next.js）

對照：Wix 租客儀表盤 `tenant-dashboard-page-full.js` ↔ Next 租客 app `app/tenant/*`。  
`tenant-invoice-page-full.js` 為營運端開單頁，不計入租客功能。

---

## 功能對照表

| 功能模塊 | Wix | Next.js | 說明 |
|----------|:---:|:-------:|------|
| Init / 登入 | ✅ | ✅ | 對齊 |
| Dashboard 主區（物業/待辦/租約日期） | ✅ | ✅ | 對齊 |
| 待辦：Approval（Accept/Reject） | ✅ | ✅ | Next 為獨立頁 |
| 待辦：Agreement（Sign） | ✅ | ✅ | 對齊 |
| Agreement 頁（預覽/簽署/過去協議） | ✅ | ✅ | 對齊 |
| Meter：餘額 / 費率 / Top-up / Postpaid 禁用 | ✅ | ✅ | 對齊 |
| Meter：同步電表 | ✅ | ✅ | Quick Stats 右上角 Sync |
| Meter：用電報表（圖表 + 歷史 + 報表） | ✅ | ✅ | usageSummary API，真實數據 |
| Smart Door（解鎖 / PIN / 儲存與產生） | ✅ | ✅ | Next 多「Generate Guest PIN」 |
| Payment（列表 / Pay Now / invoice·receipt） | ✅ | ✅ | 對齊 |
| Profile：姓名 / 電話 / 銀行 | ✅ | ✅ | 對齊 |
| Profile：entity_type / reg_no_type 寫回 | ✅ | ✅ | 對齊 |
| Profile：NRIC 正反面上傳 | ✅ | ✅ | 對齊 |
| Profile：WhatsApp (wasap.my) | ✅ | ✅ | 對齊 |
| Profile：變更 Email | ❌ | ✅ | **Next 多** |
| Feedback：文字 + photo/video 附件 | ✅ | ✅ | 對齊 |
| Overdue 門控 | ✅ | ✅ | 對齊 |

---

## 總結

| 類型 | 內容 |
|------|------|
| **少功能**（Wix 有、Next 沒有） | **無** |
| **多功能**（Next 有、Wix 本頁無） | ① 變更 Email ② Approval 獨立頁 ③ Smart Door「Generate Guest PIN」 |
| **其餘** | 上表所列功能兩邊已對齊，且 Next 端已接好後端 API。 |

---

## Tenant 進 portal.colivingjb.com 是否能看到所有數據？

**條件滿足時，可以。** 需同時滿足：

1. **入口與部署**  
   - 對外提供給租客的網址是 **portal.colivingjb.com**（或你們實際的 Portal 網域）。  
   - 該站部署的是 **這套 Next 租戶前端**（含 `app/tenant/*`、TenantProvider、tenant-api 等）。

2. **登入身份**  
   - 用戶以 **租客身份** 登入（例如 member 的 role 為 tenant，或登入後被識別為 tenantdetail 裡的 email）。

3. **後端與代理**  
   - Next 的 **API 代理**（如 `/api/portal/proxy`）已指向你們的 **ECS 後端**。  
   - **tenantdashboard** 相關 API（init、room、rental-list、usage-summary、create-payment 等）在 ECS 上可正常呼叫且回傳正確格式。

4. **資料存在**  
   - 該登入 **email** 在 **tenantdetail** 有對應記錄。  
   - 有對應的 **tenancy**（及 room、property、client 等），儀表盤、Meter、Payment、Agreement 等才會有資料。  
   - 若為 TTLock / 用電報表，需後端與 CNYIoT 等已配置好，資料才會顯示。

**若以上都滿足**：tenant 登入 portal.colivingjb.com 後，理論上可以看到與對照表一致的**所有**租客數據（儀表盤、Meter、Payment、Agreement、Smart Door、Profile、Feedback、Approval）。

**若看不到或資料不完整**，可依序檢查：  
- 登入後 session 是否帶正確 email、role  
- 瀏覽器 Network 裡呼叫的 tenantdashboard API 是否 200、回傳是否有 tenant/tenancies  
- ECS 上該 email 在 tenantdetail/tenancy 是否有資料  
- 上傳/報表是否需額外設定（如 OSS、CNYIoT 設定）
