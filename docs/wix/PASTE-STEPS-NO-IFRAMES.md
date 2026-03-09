# Step by Step — 模板/银行由 Node 直接下载（可删 #htmldownloadtemplate、#htmlbank）

在 [PASTE-STEPS.md](./PASTE-STEPS.md) 的基础上，多做下面几处粘贴，即可改为「Node 生成 Excel → 前端直接下载」，不再需要两个 iframe。

---

## 依赖（Node 端做一次）

在 ECS 项目根目录执行：

```bash
cd /home/ecs-user/app && npm install
```

（会安装 exceljs、xlsx，用于生成模板和银行 Excel。）

---

## A. backend/saas/expenses.jsw 增加 3 个导出

在 **backend/saas/expenses.jsw** 里，在 `getBulkTemplateData` 后面**追加**下面整段（不要删掉原有 export）：

```javascript
/** Node 直接生成 Excel，返回 { filename, data: base64 }，前端解码后触发下载 */
export async function getBulkTemplateFile() {
    const data = await postEcs('/api/expenses/bulk-template-file', {});
    if (data == null || !data.filename) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 银行列表或付款数据 */
export async function getBankBulkTransferData(params = {}) {
    const body = { ...params };
    if (params.bank) {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        body.email = String(email).trim();
    }
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) return { ok: false, reason: BACKEND_ERROR_REASON };
    try {
        const res = await fetchWithTimeout(
            `${baseUrl}/api/bank-bulk-transfer`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify(body)
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return { ok: false, reason: BACKEND_ERROR_REASON };
        return await res.json();
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

/** Node 直接生成银行 Excel，返回 { files: [ { filename, data: base64 }, ... ] } */
export async function getBankBulkTransferFiles(params = {}) {
    const data = await postEcs('/api/bank-bulk-transfer/files', {
        bank: params.bank,
        type: params.type,
        ids: params.ids,
        fileIndex: params.fileIndex
    });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}
```

（若你已按 [velo-backend-saas-expenses.jsw.snippet.js](./jsw/velo-backend-saas-expenses.jsw.snippet.js) 整份替换过，则已包含上述 3 个，无需再贴。）

---

## B. 页面代码 — 改 import（加上新函数）

把从 `backend/saas/expenses.jsw` 的 import 改成（增加 `getBulkTemplateFile`、`getBankBulkTransferData`、`getBankBulkTransferFiles`，去掉对 `backend/access/bankbulktransfer.jsw` 的引用）：

```javascript
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
```

---

## C. 页面代码 — 加两个工具函数（放在其他 function 附近）

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

## D. Download Template 按钮 — 整段换成（不再用 iframe）

找到 **#buttondownloadtemplate** 的 onClick（以及原来给 #htmldownloadtemplate 的 postMessage/onMessage），**整段删掉**，改成：

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

之后可删掉 **#htmldownloadtemplate** 的 iframe 及其 onMessage。

---

## E. Bank 下载 — bindBankDownload 整段换成（不再用 iframe）

找到 **bindBankDownload** 整段（以及原来给 #htmlbank 的 postMessage），**整段删掉**，改成：

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

**initBankSection** 里银行下拉改为用同一 backend：`const res = await getBankBulkTransferData();`（不传 bank），用 `res.banks` 填 `#dropdownbank`。之后可删掉 **#htmlbank** 的 iframe 及其 onMessage。

---

## 小结

| 步骤 | 做什么 |
|------|--------|
| Node | `npm install`（exceljs、xlsx） |
| JSW | 确保有 getBulkTemplateFile、getBankBulkTransferData、getBankBulkTransferFiles（见 A） |
| 前端 | import 增加上述 3 个（B） |
| 前端 | 加 base64ToBlob、triggerDownload（C） |
| 前端 | #buttondownloadtemplate 改为调 getBulkTemplateFile + 触发下载（D） |
| 前端 | bindBankDownload 改为按 chunk 调 getBankBulkTransferFiles + 逐文件触发下载（E） |
| 页面 | 可删 #htmldownloadtemplate、#htmlbank 两个 iframe |

#htmlupload 保留不变，仍用 onMessage 收 BULK_PREVIEW 再 insertExpenses。
