# 還缺的 Tutorial 圖片

Tutorial 頁面實際用到的圖 vs 你目前有的（依 copy 腳本與 alias）：下面列出**可能還缺**的檔名。  
若你已經有對應的圖，可改檔名或加 alias 後再跑 `npm run tutorial:copy-screenshots`。

---

## Owner — 目前都有對應

Tutorial 用到的：`login.png`, `portal.png`, `owner.profile.png`, `owner.properties.png`, `owner.agreement.png`, `owner.report.png`, `owner.cost.png`  
你已有：login / portal / owner.* / owner-properties → 都有對應，**不缺**。

---

## Tenant — 可能還缺 7 張

| 存檔檔名 | 對應步驟 |
|----------|----------|
| `tenant-05-profile-success.png` | 儲存 Profile 後的成功訊息 |
| `tenant-08-agreement-document.png` | 合約內容 + 簽名區 + Sign 按鈕 |
| `tenant-09-agreement-signed.png` | 簽完合約後的確認畫面 |
| `tenant-10-property-dropdown.png` | 主畫面 Property 下拉 + Meter/Door/Payment |
| `tenant-14-smartdoor-opening.png` | Smart Door「Opening…」/「Door open」 |
| `tenant-16-payment-paid.png` | 付款成功後（發票 Paid / 成功訊息） |
| `tenant-18-feedback-success.png` | 送出 Feedback 後的成功訊息 |

---

## Operator — 可能還缺 7 張

若你**沒有**用 `operator-01-login.png` 這種檔名，就會缺下面這些（tutorial 要的檔名）：

| 存檔檔名 | 對應步驟 |
|----------|----------|
| `operator-01-login.png` | 登入頁 |
| `operator-04-company-success.png` | 儲存公司後的成功訊息 |
| `operator-05-staff-list.png` | User Setting / Staff 列表 |
| `operator-06-staff-add-form.png` | 新增員工表單 |
| `operator-09-meter-smartdoor-status.png` | Integration 裡 Meter & Smart Door 狀態 |
| `operator-12-invoice-form.png` | 新增/編輯發票表單 |
| `operator-14-expense-form-or-mark-paid.png` | 新增費用 或 Mark paid 對話框 |

你若有 `operatorcompanyestting.png`、`operatoragreementsetting.png` 等，可選一張當「公司儲存成功」→ 加 alias 對到 `operator-04-company-success.png`；其餘同理，缺哪步就補哪張圖並用上面檔名存（或改 copy 腳本 alias）。

---

## 小結

- **Owner**：不缺。
- **Tenant**：缺 **7** 張（05, 08, 09, 10, 14, 16, 18）。
- **Operator**：缺 **7** 張（01, 04, 05, 06, 09, 12, 14）— 除非你已有 `operator-xx-xxx.png` 檔名。

補齊後放到 `docs/tutorial/screenshots/`，再執行一次：

```bash
npm run tutorial:copy-screenshots
```
