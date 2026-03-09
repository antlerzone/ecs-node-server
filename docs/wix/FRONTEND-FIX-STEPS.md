# 前端修正 Step（按顺序粘贴）

---

## 一、迁移报错「Duplicate column name 'paidat'」

说明 **bills 表里已经有 paidat / paymentmethod 列**，不用再执行 0020。

- 若你还没加过列：在 **ECS 上**（MySQL 装在本机或远程）跑**完整命令**（不要用字面 `...`）：  
  `cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0020_bills_paidat_paymentmethod.sql`
- 若已经报过 **Duplicate column**：直接忽略，列已存在。

**若报错 "Can't connect to local MySQL server through socket"**：说明没用上 `.env` 里的 `DB_HOST`，mysql 在连本机 socket。必须在 ECS 上执行**上面那一整行**（含 `export $(grep -v '^#' .env | xargs)` 和 `-h "$DB_HOST"`），不要只打 `mysql ... < 文件`。若 MySQL 在别的机器，确认 `.env` 里 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 正确。

---

## 二、JSW 类型错误（Property 'email' / 'filename' does not exist）

已在 **`docs/wix/jsw/velo-backend-saas-expenses.jsw.snippet.js`** 里修好：

- `getBulkTemplateFile`：对 `postEcs` 的返回值加了  
  `/** @type {{ filename?: string, data?: string } | null} */`
- `getBankBulkTransferData`：对 `body` 加了  
  `/** @type {{ bank?: string, type?: string, ids?: string[], email?: string } } */`

**你要做的**：把本仓库里 **`docs/wix/jsw/velo-backend-saas-expenses.jsw.snippet.js`** 的**整份内容**再复制到 Wix 的 **backend/saas/expenses.jsw** 覆盖保存，类型错误会消失。

---

## 三、前端：只调 backend/saas/expenses.jsw，模板/银行由 Node 直接下载

按下面 5 步改，改完可删 #htmldownloadtemplate、#htmlbank 两个 iframe。

---

### Step 1：改 import

**删掉**：`import { getBankBulkTransferData } from 'backend/access/bankbulktransfer.jsw';`

**把** `backend/saas/expenses.jsw` 的 import **换成**（增加 getBulkTemplateFile、getBankBulkTransferData、getBankBulkTransferFiles）：

```javascript
import {
    insertExpenses,
    deleteExpenses,
    updateExpense,
    bulkMarkPaid,
    getExpenses,
    getExpensesFilters,
    getBulkTemplateData,
    getBulkTemplateFile,
    getBankBulkTransferData,
    getBankBulkTransferFiles
} from 'backend/saas/expenses.jsw';
```

（不再从 backend/access/bankbulktransfer.jsw 引入任何东西。）

---

### Step 2：加两个工具函数

在 **`const EXPENSE_PAGE_SIZE = 10;`** 上面或下面，**新增**：

```javascript
function base64ToBlob(b64, mimeType) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mimeType || 'application/octet-stream' });
}

function triggerDownload(blob, filename) {
    const doc = typeof globalThis !== 'undefined' && globalThis.document;
    if (!doc) return;
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.click();
    URL.revokeObjectURL(url);
}
```
（用 `globalThis.document` 避免 IDE 报 "Cannot find name 'document'"；发布后在浏览器里会正常下载。）

---

### Step 3：Download Template — 整段换成（不再用 iframe）

找到 **bindBulkUploadSection** 里 **#buttondownloadtemplate** 的 onClick 以及 **#htmldownloadtemplate** 的 onMessage，**整段删掉**，改成下面这一整段（只保留 #buttondownloadtemplate 的 onClick，不再 postMessage、不再 onMessage）：

在 `$w('#buttondownloadtemplate').onClick(...)` 和 `$w('#htmldownloadtemplate').onMessage(...)` 的位置，**替换为**：

```javascript
    /* =========================
       DOWNLOAD TEMPLATE（Node 直接生成，无需 iframe）
    ========================== */
    $w('#buttondownloadtemplate').onClick(async () => {
        try {
            $w('#buttondownloadtemplate').disable();
            $w('#buttondownloadtemplate').label = "Loading...";
            const res = await getBulkTemplateFile();
            if (res && res.filename && res.data) {
                const blob = base64ToBlob(res.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                triggerDownload(blob, res.filename);
            }
        } catch (err) {
            console.error("Template download error:", err);
        } finally {
            $w('#buttondownloadtemplate').enable();
            $w('#buttondownloadtemplate').label = "Download Template";
        }
    });
```

并**删掉**原先的 `$w('#htmldownloadtemplate').onMessage(...)` 整段。

---

### Step 4：Bank 下载 — bindBankDownload 整段换成（不再用 iframe）

找到 **function bindBankDownload()** 的**整段**（从 `function bindBankDownload()` 到对应的闭合 `};`），**整段替换为**：

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
        } catch (err) {
            console.error("Bank File Error:", err);
        } finally {
            $w('#buttondownloadfile').enable();
            $w('#buttondownloadfile').label = "Download File";
        }
    });
}
```

---

### Step 5：initBankSection 改用 saas 的 getBankBulkTransferData

**initBankSection** 里已经是 `const res = await getBankBulkTransferData();`，只要 **import 改为从 backend/saas/expenses.jsw 引入**（Step 1 已包含 getBankBulkTransferData），这里**不用改代码**，只确保不再从 `backend/access/bankbulktransfer.jsw` 引入即可。

---

## 四、可选：删 iframe

- 在 Wix 编辑器里删掉 **#htmldownloadtemplate**、**#htmlbank** 两个 iframe 元素（或隐藏不用）。
- **#htmlupload** 保留，BULK_PREVIEW 逻辑不变。

---

## 五、检查清单

| 项 | 状态 |
|----|------|
| 迁移 0020 报 Duplicate column | 忽略，列已存在 |
| JSW 类型错误 | 用最新 velo-backend-saas-expenses.jsw.snippet.js 覆盖 backend/saas/expenses.jsw |
| import 去掉 bankbulktransfer.jsw，从 saas/expenses.jsw 引入 getBulkTemplateFile、getBankBulkTransferData、getBankBulkTransferFiles | Step 1 |
| 加上 base64ToBlob、triggerDownload | Step 2 |
| #buttondownloadtemplate 改为 getBulkTemplateFile + 触发下载，删 #htmldownloadtemplate onMessage | Step 3 |
| bindBankDownload 改为 getBankBulkTransferFiles + 逐文件触发下载 | Step 4 |
