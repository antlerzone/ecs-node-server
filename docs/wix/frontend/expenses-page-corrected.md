# 修正版：Expenses 页面（统一走 backend/saas/expenses.jsw + 快首屏）

你要做的只有两件事：

1. **在 Wix 里新建 `backend/saas/expenses.jsw`**，把 [velo-backend-saas-expenses.jsw.snippet.js](../jsw/velo-backend-saas-expenses.jsw.snippet.js) 整份粘贴进去（或从该文件复制全部内容）。
2. **在页面代码里**做下面 3 处修改（其余你已有代码保持不变）。

---

## 1) 改 import：只用 backend/saas/expenses.jsw

把原来的：

```javascript
import {
    insertExpenses,
    deleteExpenses,
    updateExpense,
    bulkMarkPaid,
    getExpenses,
    getBulkTemplateData
} from 'backend/tenancy/expenses.jsw';
```

改成：

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

（多引进了 `getExpensesFilters`，后面筛选项和 bulk 用。）

---

## 2) 筛选项和 Bulk 用 Node，不再用 wixData

**替换 `setupExpensesFilters` 整段**为（用 ECS 的 filters，不再 query PropertyDetail / UtilityBills）：

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

**替换 `loadBulkUploadMaps` 整段**为（用 ECS 的 filters 建 propertyMap / supplierMap，不再 wixData）：

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

（若你原来有 `let propertyMap = {}; let supplierMap = {};`，保留那两行声明，这里只改函数体即可。）

---

## 3) 快首屏：先出布局，再跑 startInitAsync

目标：不要长时间白屏，先让用户看到「有内容的页面」（表头、区块），再在背后完成 access 和 enable buttons。

**改 `$w.onReady`** 为：

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

**改 `startInitAsync` 开头**：不要一进来就显示全屏 Loading，只有出错再显示文案：

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
    // ... 后面你原来的 clientCurrency、bindExpenseDelete、enableMainActions 等都不变
    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
    // ... 其余照旧，最后不要 $w('#textstatusloading').hide(); 因为 onReady 里已 hide
}
```

这样首帧就是：默认 section + 表头/布局可见，按钮先 disabled；`getAccessContext()` 跑完后要么进正常流程并 enable 按钮，要么显示错误文案。  
若你希望「完全不要 #textstatusloading 在首帧出现」，可在一开始就 `$w('#textstatusloading').hide()` 或把它放在默认折叠的区块里。

---

## 小结

| 你要做的 | 说明 |
|----------|------|
| 新建 `backend/saas/expenses.jsw` | 粘贴 [velo-backend-saas-expenses.jsw.snippet.js](../jsw/velo-backend-saas-expenses.jsw.snippet.js) 全部内容 |
| 改 import | 从 `backend/saas/expenses.jsw` 引入，并加上 `getExpensesFilters` |
| 改 `setupExpensesFilters` | 用 `getExpensesFilters()` 的 `properties`、`types` 填下拉，不再用 wixData |
| 改 `loadBulkUploadMaps` | 用 `getExpensesFilters()` 的 `properties`、`suppliers` 建 propertyMap、supplierMap |
| 改 onReady + startInitAsync | 先 `initDefaultSection()`、hide 全屏 Loading，再 `await startInitAsync()`，只有报错时再显示文案 |

这样：**列表和筛选项都从 Node（ECS）来，不再依赖 Wix CMS**；**首屏先出布局再跑 access**，避免长时间白屏。  
insert/delete/update/bulkMarkPaid/getBulkTemplateData 目前仍是存根，等 Node 实现后再在 `backend/saas/expenses.jsw` 里改成调 ECS 即可。
