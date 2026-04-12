# Prompt for v0.app — Owner Portal Tutorial Design

Use this when you ask **v0.app** to design the Owner Portal tutorial. Two options:

- **Full prompt** (below): detailed structure + style + don’ts. Best for a complete first pass.
- **Short prompt** (file end): one paragraph, same intent. Use if v0 has a short input limit.

---

## PROMPT (copy from here)

Design a **step-by-step tutorial / user manual** for a **Property Owner Portal** in a Coliving / property management SaaS. The audience is **property owners** who need to log in, complete their profile, view properties and tenancies, sign agreements, and download reports.

### Style & tone
- **IKEA-manual style**: clear numbered steps, minimal text, “What you do” + “What you see” for each step.
- **English** only. Professional, friendly, no jargon.
- **Visual hierarchy**: big part numbers (Part 1, 2, …), clear step titles (Step 1.1, 1.2, …), short body text.
- **Screenshots**: each step that has a screenshot should show it **full-width or full-page** (no tiny cropped boxes). One screenshot per step when applicable.
- **No grid/table layout for “Quick reference”**: use a **simple numbered list** (1. Log in — Owner / Portal login page), not a table with cells/borders.
- **Overview table** (What the Owner Portal does): use a proper **two-column table** — left column “Area”, right column “What you can do”, with readable column widths so text is not cut off.
- **Troubleshooting**: can be a two-column table (Problem | What to try) or a simple list of problem + solution pairs.

### Structure (sections to include)

1. **Title**
   - “Owner Portal — Step-by-Step Manual”, subtitle “English · For property owners”.

2. **What you need before you start**
   - Bullet list: invitation from operator, login (Wix or Portal), browser (Chrome, Safari, or Edge).

3. **Overview: What the Owner Portal does**
   - Table:
     - My Property → See properties and units; view tenancies (who is renting, period, rent).
     - Profile → Update name, phone, address, bank, NRIC; upload NRIC front/back.
     - My Agreement → View and sign agreements; complete e-signature.
     - My Report → Select property and period; view Owner Report; download PDF.
     - Cost / Support → View cost reports; download Cost PDF; contact support.
   - Short note: “Complete your Profile first. Until your profile is complete, the portal may only allow you to open the Profile section.”

4. **Part 1 — Log in and open the Owner Portal**
   - Step 1.1: Open the login page — What you do: Go to the URL from your operator and open Owner / Owner Portal. What you see: Login screen (email, password, or Log in with Google). [Placeholder for screenshot: login page.]
   - Step 1.2: Log in — What you do: Enter email and password, click Log in. What you see: Main Owner Portal with sidebar (My Property, Profile, My Agreement, My Report, Cost, Approvals, Support). [Placeholder for screenshot: dashboard.]

5. **Part 2 — Complete your Profile (do this first)**
   - Step 2.1: Open Profile — What you do: Click Profile. What you see: Fields for name, phone, address, bank, NRIC, upload areas. [Screenshot: profile page.]
   - Step 2.2: Fill in details (name, phone, address, bank, account number, NRIC upload). Tip: Use clear NRIC photos.
   - Step 2.3: Save profile — What you see: Success message; other menu items may become available.

6. **Part 3 — View your properties and tenancies**
   - Step 3.1: Open My Property — What you see: Property dropdown, operator dropdown, list of tenancies (room, tenant, period, rent). [Screenshot: properties list.]
   - Step 3.2: Change property (if several) — list updates.

7. **Part 4 — Sign agreements (My Agreement)**
   - Step 4.1: Open My Agreement — What you see: List of agreements with status (Pending / Ready to sign / Signed), View or Sign button. [Screenshot: agreement list.]
   - Step 4.2: Open an agreement — document view with signature area and Sign / Agree button.
   - Step 4.3: Sign — Enter signature, click Sign/Agree; confirmation and status “Signed”.

8. **Part 5 — View and download reports (My Report)**
   - Step 5.1: Open My Report — What you see: Property dropdown, period selector, table (rental income, expenses, net payout), Export PDF button. [Screenshot: report page.]
   - Step 5.2: Select property and period — table updates.
   - Step 5.3: Download Owner Report PDF — click Export PDF; file downloads.

9. **Part 6 — Cost report and support**
   - Step 6.1: Open Cost report — What you see: Cost list/table, Download Cost PDF button. [Screenshot: cost report.]
   - Step 6.2: Download Cost PDF.
   - Step 6.3: Support — Contact/Support in sidebar.

10. **Quick reference — Owner Portal**
    - **Do NOT use a table/grid.** Use a **numbered list** only, e.g.:
    - 1. Log in — Owner / Portal login page
    - 2. Complete Profile (name, phone, bank, NRIC) — Profile section
    - 3. View properties and tenancies — My Property
    - 4. Sign agreements — My Agreement → View/Sign → Sign
    - 5. View report and download PDF — My Report → select property & period → Export PDF
    - 6. Cost report PDF / Support — Cost section → Export; Support section

11. **Troubleshooting**
    - Cannot log in → Check email/password; Forgot password; contact operator.
    - Profile Save does nothing → Fill required fields; check errors; try another browser.
    - NRIC upload fails → Clear image, size limit, try again.
    - No agreements in list → Contact operator to create agreement.
    - Export PDF disabled → Select property and period; ensure data exists.
    - Menu items greyed out → Complete Profile first; refresh and log in again.

### Design deliverables (choose one or both)
- **Option A**: A **web page / React component** (e.g. Next.js + Tailwind) that renders this tutorial with clear sections, collapsible parts, and image placeholders (e.g. `<img src="/screenshots/login.png" />`). Each screenshot area should be **full-width** and scale nicely on mobile.
- **Option B**: A **print/PDF-friendly layout** (same content) with clear page breaks, full-page or full-width screenshots per step, and the Quick reference as a **list only** (no table grid).

### Image placeholders
Use these filenames for screenshot slots so we can drop in real assets later: `login.png`, `portal.png`, `owner.profile.png`, `owner.properties.png`, `owner.agreement.png`, `owner.report.png`, `owner.cost.png`. Each image should occupy **full content width** or **full page**; no half-page or small thumbnails.

### Don’t
- Don’t use a grid/table for “Quick reference” (use a numbered list).
- Don’t crop or shrink screenshots to a small box; keep them full-width or full-page.
- Don’t use long paragraphs; keep steps short and scannable.

---

## END PROMPT (copy until here)

---

## How to use

1. Open [v0.app](https://v0.dev) (or your v0 interface).
2. Copy everything between `## PROMPT (copy from here)` and `## END PROMPT`.
3. Paste into the prompt box and submit.
4. If v0 returns components, place screenshot images in the paths it uses (e.g. `/screenshots/login.png`) or adjust paths to match your `docs/tutorial/screenshots/` folder.
5. For PDF export, use the generated layout with “Print to PDF” in the browser, or keep using `npm run tutorial:owner-pdf` with the existing script and this prompt only as reference for content/structure.

---

## Short prompt (if v0 has character limit)

Design an IKEA-style step-by-step tutorial for a Property Owner Portal (Coliving SaaS). Audience: property owners. Include: (1) Title + "What you need before you start" bullets; (2) Overview table: Area | What you can do (My Property, Profile, My Agreement, My Report, Cost/Support); (3) Part 1–6 with numbered steps (Log in, Profile, My Property, My Agreement, My Report, Cost and Support), each step with "What you do" and "What you see" and a full-width screenshot placeholder (login.png, portal.png, owner.profile.png, etc.); (4) Quick reference as a **numbered list only** (no table/grid): e.g. "1. Log in — Owner / Portal login page"; (5) Troubleshooting as problem–solution list. Screenshots must be full-width or full-page, not cropped. English only, minimal text, clear headings (Part 1, Step 1.1). Output: React/Next.js + Tailwind component or PDF-friendly layout.
