# Tutorials — Step-by-Step Manuals (IKEA-Style)

This folder contains **role-based manuals** and a general overview for the Coliving SaaS Property Management platform. Each manual is in **English**, with **numbered steps**, **“What you do” / “What you see”** explanations, and **screenshot placeholders** so you can add real page screenshots and produce clear, IKEA-style guides.

---

## Three role-based manuals (English + screenshot placeholders)

| File | For | Content |
|------|-----|--------|
| **[owner-tutorial.md](./owner-tutorial.md)** | **Owners** | Log in → Profile (name, bank, NRIC) → My Property & tenancies → My Agreement (sign) → My Report (view & download PDF) → Cost report & Support. |
| **[tenant-tutorial.md](./tenant-tutorial.md)** | **Tenants** | Log in → Profile → Approve operator → Sign agreement → Property dropdown → Meter (usage, top-up) → Smart Door (open) → Payment (rent/invoices) → Feedback. |
| **[operator-tutorial.md](./operator-tutorial.md)** | **Operators (staff)** | Log in → Company Profile → User Setting (staff) → Integration (Accounting, Meter, Smart Door) → Property/Room/Tenancy → Tenant Invoice → Expenses (incl. bank bulk) → Admin (feedback, refund, sign agreements) → Billing/Top-up. |

Each manual includes:

- **What you need before you start**
- **Overview** table of what that role can do
- **Numbered steps** (Part 1, 2, … with Step 1.1, 1.2, …)
- **What you do** (action in bold) and **What you see** (description of the screen)
- **\[SCREENSHOT: …]** placeholders — replace these with real screenshots of your pages
- **Tips** and **Troubleshooting** tables
- **Quick reference** table at the end

---

## How to add screenshots (page display)

教程裡已經寫好圖片檔名，你**只要**：

1. **看清單**：打開 **[screenshots/SCREENSHOT-LIST.md](./screenshots/SCREENSHOT-LIST.md)**，照表格的「檔名」和「要截的畫面」去截圖。
2. **重新命名**：把每張截圖存成清單裡的檔名（例如 `owner-01-login.png`、`tenant-02-main.png`、`operator-16-admin-list.png`）。
3. **放進資料夾**：把檔案放進 **`docs/tutorial/screenshots/`**。
4. **完成**：不用改任何 .md，放進去就會自動顯示。

清單裡有 **Owner 7 張、Tenant 18 張、Operator 22 張** 的對照表，用 **.png** 或 **.jpg** 都可以（副檔名與檔名一致即可）。

**建議到 demo 站截圖：** 使用 **demo.colivingjb.com**（不接後端），已內建示範資料（agreement、tenancy、invoice、report、expenses、admin 等都有項目）。登入後選 Owner / Tenant / Operator，各頁面都會有內容，方便對照清單截圖。

---

## Export to PDF (with screenshots)

Once screenshots are in place, you can export each manual to PDF:

**Using Pandoc (recommended):**

```bash
# Owner manual → PDF
pandoc docs/tutorial/owner-tutorial.md -o docs/tutorial/owner-tutorial.pdf --pdf-engine=xelatex -V mainfont="Noto Sans CJK SC"

# Tenant manual → PDF
pandoc docs/tutorial/tenant-tutorial.md -o docs/tutorial/tenant-tutorial.pdf --pdf-engine=xelatex -V mainfont="Noto Sans CJK SC"

# Operator manual → PDF
pandoc docs/tutorial/operator-tutorial.md -o docs/tutorial/operator-tutorial.pdf --pdf-engine=xelatex -V mainfont="Noto Sans CJK SC"
```

If you use only English in the markdown, you can omit the font option:

```bash
pandoc docs/tutorial/owner-tutorial.md -o docs/tutorial/owner-tutorial.pdf
```

**Using VS Code / Cursor:** Install a “Markdown PDF” or “Markdown to PDF” extension and export from the editor.

**Using project script (no Pandoc needed):** From project root run `npm run tutorial:owner-pdf` to generate `docs/tutorial/owner-tutorial.pdf` from `owner-tutorial.md` and images in `screenshots/`.

---

## General overview (legacy)

| File | Description |
|------|-------------|
| **usage-tutorial.md** | General overview (Chinese): architecture, roles, environment, cron, data import, docs index. |
| **usage-tutorial.pdf** | Generated overview PDF (English, script output). |
| **usage-tutorial.pptx** | Generated overview PowerPoint (English, script output). |

Generate overview PDF/PPTX from project root:

```bash
npm run tutorial:pdf    # PDF only
npm run tutorial:pptx   # PPTX only
npm run tutorial        # Both
```

---

## Summary

- **Owner / Tenant / Operator**: use **owner-tutorial.md**, **tenant-tutorial.md**, **operator-tutorial.md** for IKEA-style, English, step-by-step manuals with **screenshot placeholders**.
- **Screenshots**: take real page screenshots, save under e.g. `screenshots/`, and replace each `[SCREENSHOT: …]` block with `![…](path/to/image.png)`.
- **PDF**: after adding screenshots, use **pandoc** (or an editor extension) to export each role’s `.md` to PDF for distribution.

For API and implementation details, see **docs/index.md** and **docs/readme/index.md**.
