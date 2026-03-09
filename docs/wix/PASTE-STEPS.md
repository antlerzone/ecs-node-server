# Step by Step — 只会粘贴版

每一步都是：**去哪里** → **粘贴下面内容**。按顺序做。

---

## Step 1：ECS 上给数据库加两列（做一次）

**去哪里**：SSH 进你的 ECS 服务器，在终端里执行。

**整段复制粘贴**（一行）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0020_bills_paidat_paymentmethod.sql
```

如果报错说列已存在，可以忽略。

---

## Step 1b：ECS 上回填 propertydetail.management_id / internettype_id（做一次）

**去哪里**：SSH 进 ECS，在终端执行（用 management_wixid / internettype_wixid 从 supplierdetail 回填 FK）。

**整段复制粘贴**（一行）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0024_backfill_propertydetail_management_internettype_id.sql
```

---

## Step 1c：ECS 上加 wifi_id 列 + 回填 agreementtemplate_id（做一次）

**去哪里**：SSH 进 ECS，在终端执行。会：1）给 propertydetail 加 `wifi_id` 列（JP Reference 用）；2）用 agreementtemplate_wixid 回填 agreementtemplate_id。

**整段复制粘贴**（一行）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0025_propertydetail_wifi_id_and_backfill_agreementtemplate.sql
```

若报错 `Duplicate column name 'wifi_id'`，说明列已存在，可只执行回填：  
`cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "UPDATE propertydetail p INNER JOIN agreementtemplate a ON a.wix_id = p.agreementtemplate_wixid AND p.agreementtemplate_wixid IS NOT NULL AND p.agreementtemplate_wixid != '' SET p.agreementtemplate_id = a.id;"`

---

## Step 1d：ECS 上 supplierdetail 加 utility_type 列（做一次）

**去哪里**：SSH 进 ECS。用于在 supplierdetail 上标明该供应商是电/水/网络，JP Reference 1 优先按此列取值。

**整段复制粘贴**（一行）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0026_supplierdetail_utility_type.sql
```

加列后需在库里给 TNB/SAJ/网络供应商的 supplierdetail 行填上 `utility_type`：`electric`、`water`、`wifi`（可手写 SQL 或后台维护）。

---

## Step 2：Wix Backend — 新建/替换 saas/expenses.jsw

**去哪里**：Wix 编辑器 → 左侧 **Code (Velo)** → **Backend** → 新建或打开 **saas/expenses.jsw**（没有 saas 文件夹就先建 saas，再建 expenses.jsw）。

**整段复制粘贴**（从下一行到 “粘贴结束” 为止，全部替换该文件内容）：

```javascript
/* ======================================================
   backend/saas/expenses.jsw — 统一入口，全部走 ECS Node
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function getEcsCreds() {
    const token = await wixSecretsBackend.getSecret('ecs_token');
    const username = await wixSecretsBackend.getSecret('ecs_username');
    const baseUrl = await wixSecretsBackend.getSecret('ecs_base_url');
    return {
        token: token != null ? String(token).trim() : '',
        username: username != null ? String(username).trim() : '',
        baseUrl: baseUrl != null ? String(baseUrl).trim().replace(/\/$/, '') : ''
    };
}

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

async function postEcs(path, body) {
    try {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return null;
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) return null;
        const res = await fetchWithTimeout(
            `${baseUrl}${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim(), ...body })
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        if (e && e.name === 'AbortError') return null;
        return null;
    }
}

export async function getExpenses(opts = {}) {
    const data = await postEcs('/api/expenses/list', {
        property: opts.property,
        type: opts.type,
        from: opts.from,
        to: opts.to,
        search: opts.search,
        sort: opts.sort,
        page: opts.page,
        pageSize: opts.pageSize
    });
    if (data && Array.isArray(data.items)) return data;
    return { items: [], totalPages: 1, currentPage: 1, total: 0 };
}

export async function getExpensesFilters() {
    const data = await postEcs('/api/expenses/filters', {});
    if (data && data.properties) return data;
    return { properties: [], types: [], suppliers: [] };
}

export async function insertExpenses(records) {
    const data = await postEcs('/api/expenses/insert', { records });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

export async function deleteExpenses(ids) {
    const data = await postEcs('/api/expenses/delete', { ids });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

export async function updateExpense(id, data) {
    const res = await postEcs('/api/expenses/update', {
        id,
        paid: data.paid,
        paidat: data.paidat,
        paymentmethod: data.paymentmethod
    });
    if (res == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return res;
}

export async function bulkMarkPaid(ids, date, method) {
    const data = await postEcs('/api/expenses/bulk-mark-paid', {
        ids,
        paidAt: date,
        paymentMethod: method
    });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

export async function getBulkTemplateData() {
    const data = await postEcs('/api/expenses/bulk-template', {});
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}
```

粘贴结束（Step 2）

---

## Step 3：Wix 页面代码 — 改 import

**去哪里**：同一站点 → **Pages** → 打开你的 Expenses 页面 → **Code**（或该页的 Page Code）。找到顶上的 import，把**整行**从 tenancy 改成下面这段。

**原来大概长这样**：
```javascript
} from 'backend/tenancy/expenses.jsw';
```

**整段换成**（复制下面 10 行）：

```javascript
import {
    insertExpenses,
    deleteExpenses,
    updateExpense,
    bulkMarkPaid,
    getExpenses,
    getExpensesFilters,
    getBulkTemplateData
} from 'backend/saas/expenses.jsw';
```

---

## Step 4：同一页面 — 换掉 setupExpensesFilters 整段

**去哪里**：同一页代码里，搜 **setupExpensesFilters**，找到整个函数（从 `async function setupExpensesFilters()` 到函数结束的 `}`）。

**整段删掉，粘贴下面**：

```javascript
async function setupExpensesFilters() {
    const res = await getExpensesFilters();
    const properties = res.properties || [];
    const types = res.types || [];
    $w('#dropdownproperty').options = [
        { label: 'All Property', value: 'ALL' },
        ...properties.map(p => ({ label: p.label, value: p.value }))
    ];
    $w('#dropdowntype').options = [
        { label: 'All Type', value: 'ALL' },
        ...types.map(t => ({ label: t.label, value: t.value }))
    ];
    $w('#dropdownsort').options = [
        { label: 'New to Old', value: 'new' },
        { label: 'Old to New', value: 'old' },
        { label: 'A > Z', value: 'az' },
        { label: 'Z > A', value: 'za' },
        { label: 'Amount Big to Small', value: 'amountdesc' },
        { label: 'Amount Small to Big', value: 'amountasc' },
        { label: 'Paid', value: 'paid' },
        { label: 'Unpaid', value: 'unpaid' }
    ];
    bindExpensesFilterEvents();
}
```

---

## Step 5：同一页面 — 换掉 loadBulkUploadMaps 整段

**去哪里**：同一页代码里，搜 **loadBulkUploadMaps**，找到整个函数。

**整段删掉，粘贴下面**：

```javascript
async function loadBulkUploadMaps() {
    const res = await getExpensesFilters();
    const properties = res.properties || [];
    const suppliers = res.suppliers || [];
    propertyMap = {};
    supplierMap = {};
    properties.forEach(p => {
        propertyMap[p.label] = p.value;
    });
    suppliers.forEach(s => {
        supplierMap[s.title] = s.id;
    });
}
```

---

## Step 6：同一页面 — 换掉 onReady

**去哪里**：搜 **$w.onReady** 或 **onReady**，找到 `$w.onReady(async () => { ... });` 整段。

**整段换成**：

```javascript
$w.onReady(async () => {
    initDefaultSection();
    disableAllMainButtons();
    $w('#textstatusloading').hide();

    await startInitAsync();

    if (accessCtx && accessCtx.ok) {
        $w('#textstatusloading').hide();
    }
});
```

---

## Step 7：同一页面 — 改 startInitAsync 开头

**去哪里**：搜 **startInitAsync**，找到 `async function startInitAsync()`。只改**函数最前面**：从 `accessCtx = await getAccessContext();` 到 **if (!accessCtx.ok) 整段** 和 **clientCurrency 那一行**。

**把「从 accessCtx = ... 到 clientCurrency = ... 那一行」整段换成下面**（后面的 if (accessCtx.credit?.ok === false)、bindExpenseDelete 等**不要删**，保留）：

```javascript
async function startInitAsync() {
    accessCtx = await getAccessContext();

    if (!accessCtx.ok) {
        console.log('Access denied, reason:', accessCtx.reason);
        $w('#textstatusloading').text = accessCtx.reason
            ? `You don't have account yet (${accessCtx.reason})`
            : "You don't have account yet";
        $w('#textstatusloading').show();
        showAccessDenied($w('#textstatusloading').text);
        return;
    }

    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
```

接着下面**保留你原来的**：
- `if (accessCtx.credit?.ok === false) { await enterForcedTopupModeManage(); return; }`
- `bindExpenseDelete();`
- … 一直到 `enableMainActions();` 等，都不要动。

---

## 做完后

保存 → 发布。打开网站，登录后进 Expenses 试：列表、筛选、新建、删除、标记已付、Bulk 上传、下载模板、Bank 下载，都应正常。

| Step | 做啥 |
|------|------|
| 1 | ECS 终端粘贴一行命令（加 paidat、paymentmethod 列） |
| 2 | Wix Backend 建/打开 saas/expenses.jsw，整份粘贴 Step 2 代码 |
| 3 | 页面代码：import 换成 backend/saas/expenses.jsw + getExpensesFilters |
| 4 | 页面代码：setupExpensesFilters 整段换成上面 |
| 5 | 页面代码：loadBulkUploadMaps 整段换成上面 |
| 6 | 页面代码：onReady 整段换成上面 |
| 7 | 页面代码：startInitAsync 开头换成上面，后面保留 |
