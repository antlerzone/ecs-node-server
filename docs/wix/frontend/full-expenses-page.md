# 完整版前端 — 只调 backend/saas/expenses.jsw，Node 直接生成 Excel 下载

- **Import**：只从 `backend/saas/expenses.jsw` 拿 expenses + bank（列表、筛选、增删改、Bulk、模板下载、银行列表与银行文件下载）；access 用 `backend/access/manage`，billing/topup 用 `backend/billing`、`backend/billing/topup`。
- **#buttondownloadtemplate**：调用 `getBulkTemplateFile()`，用返回的 base64 在前端触发下载，**可删掉 #htmldownloadtemplate  iframe**。
- **#buttondownloadfile**：按 chunk 调用 `getBankBulkTransferFiles()`，对返回的每个 file 用 base64 触发下载，**可删掉 #htmlbank iframe**。
- **#htmlupload**：保留，仍用 onMessage 收 BULK_PREVIEW，再调 `insertExpenses`。

下面是一段**完整可粘贴**的页面代码（只保留与 expenses/bank/topup 相关的核心逻辑，你原有按钮 ID 与结构不变的话可直接替换对应部分）。

---

## 1) Import 与常量（粘贴到文件顶部）

```javascript
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo } from 'backend/billing/billing';
import { startNormalTopup } from 'backend/billing/topup';
import {
    getExpenses,
    getExpensesFilters,
    insertExpenses,
    deleteExpenses,
    updateExpense,
    bulkMarkPaid,
    getBulkTemplateFile,
    getBankBulkTransferData,
    getBankBulkTransferFiles
} from 'backend/saas/expenses.jsw';

const EXPENSE_PAGE_SIZE = 10;
const MAIN_SECTIONS = ['topup', 'expenses', 'expensesinput', 'bulkupload', 'bank'];
const bulkColumns = [
    { id: "property", dataPath: "property", label: "Property", type: "string" },
    { id: "supplier", dataPath: "supplier", label: "Supplier", type: "string" },
    { id: "description", dataPath: "description", label: "Description", type: "string" },
    { id: "amount", dataPath: "amount", label: "Amount", type: "string" },
    { id: "period", dataPath: "period", label: "Period", type: "string" }
];
```

---

## 2) 下载用工具函数（base64 → 触发下载，无需 iframe）

```javascript
function base64ToBlob(b64, mimeType) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mimeType || 'application/octet-stream' });
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.click();
    URL.revokeObjectURL(url);
}
```

---

## 3) Download Template 按钮 — Node 生成 Excel 直接下载（可删 #htmldownloadtemplate）

把原来「发 postMessage 给 #htmldownloadtemplate」的逻辑整段换成下面：

```javascript
$w('#buttondownloadtemplate').onClick(async () => {
    try {
        $w('#buttondownloadtemplate').disable();
        $w('#buttondownloadtemplate').label = "Loading...";
        const res = await getBulkTemplateFile();
        if (res && res.filename && res.data) {
            const blob = base64ToBlob(res.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            triggerDownload(blob, res.filename);
        }
    } catch (e) {
        console.error('Template download failed:', e);
    } finally {
        $w('#buttondownloadtemplate').enable();
        $w('#buttondownloadtemplate').label = "Download Template";
    }
});
```

**可删**：不再需要 #htmldownloadtemplate 的 onMessage、以及该 iframe 元素本身。

---

## 4) Bank File 下载 — Node 生成直接下载（可删 #htmlbank）

把原来「发 postMessage 给 #htmlbank」、以及 #htmlbank 的 onMessage 整段换成下面。仍按 chunk 调接口，对返回的每个文件触发下载：

```javascript
function bindBankDownload() {
    $w('#buttondownloadfile').onClick(async () => {
        const selectedBank = $w('#dropdownbank').value;
        const allIds = Array.from(selectedExpenseIds);
        if (!allIds.length) return;

        $w('#buttondownloadfile').disable();
        $w('#buttondownloadfile').label = "Generating...";
        const CHUNK_SIZE = 99;
        let fileIndex = 1;
        try {
            for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
                const chunkIds = allIds.slice(i, i + CHUNK_SIZE);
                const res = await getBankBulkTransferFiles({
                    bank: selectedBank,
                    type: "supplier",
                    ids: chunkIds,
                    fileIndex
                });
                if (res && res.files && res.files.length) {
                    for (const f of res.files) {
                        if (f.filename && f.data) {
                            const blob = base64ToBlob(f.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                            triggerDownload(blob, f.filename);
                        }
                    }
                }
                fileIndex++;
            }
        } catch (e) {
            console.error('Bank file download failed:', e);
        } finally {
            $w('#buttondownloadfile').enable();
            $w('#buttondownloadfile').label = "Download File";
        }
    });
}
```

**可删**：不再需要 #htmlbank 的 onMessage、以及该 iframe 元素本身。Bank 列表仍用 `getBankBulkTransferData()`（无 bank 参数）取 `banks` 填下拉，已在下面 initBankSection 里用同一 backend。

---

## 5) initBankSection — 只用 backend/saas/expenses.jsw

保证银行下拉与关闭按钮用同一入口，例如：

```javascript
async function initBankSection() {
    const res = await getBankBulkTransferData();
    if (!res || !res.banks || !res.banks.length) return;
    $w('#dropdownbank').options = res.banks.map(b => ({ label: b.label, value: b.value }));
    $w('#dropdownbank').value = res.banks[0].value;
    bindBankDownload();
    $w('#buttonclosebank').onClick(async () => {
        await switchSectionAsync('expenses');
    });
}
```

这样 expenses + bank 都只调 `backend/saas/expenses.jsw`，不再需要 `backend/access/bankbulktransfer.jsw`。

---

## 6) 其他你已有逻辑（保持不变）

- **setupExpensesFilters**：用 `getExpensesFilters()` 的 `properties`、`types` 填下拉（见 PASTE-STEPS Step 4）。
- **loadBulkUploadMaps**：用 `getExpensesFilters()` 的 `properties`、`suppliers` 建 `propertyMap`、`supplierMap`（见 PASTE-STEPS Step 5）。
- **onReady / startInitAsync**：快首屏（见 PASTE-STEPS Step 6、7）。
- **#htmlupload**：保留 onMessage 收 `BULK_PREVIEW`，校验后 `insertExpenses(records)`，逻辑不变。

---

## 小结

| 项目 | 做法 |
|------|------|
| 后端入口 | 只调 `backend/saas/expenses.jsw`（expenses + bank） |
| 模板下载 | #buttondownloadtemplate → `getBulkTemplateFile()` → base64 触发下载，可删 #htmldownloadtemplate |
| 银行文件 | #buttondownloadfile → 按 chunk `getBankBulkTransferFiles()` → 每个 file base64 触发下载，可删 #htmlbank |
| 上传 | 保留 #htmlupload + BULK_PREVIEW → `insertExpenses` |

Node 端已提供：

- `POST /api/expenses/bulk-template-file` → 返回 `{ filename, data: base64 }`
- `POST /api/bank-bulk-transfer/files` → 返回 `{ files: [ { filename, data: base64 }, ... ] }`

JSW 已提供：`getBulkTemplateFile()`、`getBankBulkTransferData()`、`getBankBulkTransferFiles()`。
