# Bulk Upload iframe（#htmlupload）

已不用 CMS，改为：**访客上传文件 → 预览在 #tablebulkupload → 点击 #buttonbulkuploadnow 插入到 table**。

## 流程

1. 访客在 **#htmlupload** 里选择 CSV 或 Excel 文件上传。
2. iframe 内解析文件，通过 `postMessage({ type: 'BULK_PREVIEW', rows: [...] })` 发给父页面。
3. 父页面把有效行填入 `bulkUploadRows`，在 **#tablebulkupload** 中展示预览。
4. 访客点击 **#buttonbulkuploadnow**，调用 `insertExpenses` 写入后端 table。

## 使用方式

- **方式 A**：把 `bulk-upload-iframe.html` 部署到可访问的 URL，在 Wix 里把 **#htmlupload**（HTML iframe）的 `src` 设为该 URL。
- **方式 B**：把 `bulk-upload-iframe.html` 的完整 HTML 复制到 Wix「嵌入代码 / HTML」元素里（需能接受 iframe 或嵌入 HTML 的组件）。

## 文件格式

- **CSV**：第一行为表头，列名需为 `Property`, `Supplier`, `Description`, `Amount`, `Period`（大小写不敏感）。  
  - Property / Supplier 的值需与站点内 Property 的 label、Supplier 的 title 一致，否则会在预览时被标为“未找到”。
- **Excel**：同上列名；若要在 iframe 内直接解析 .xlsx，需在 iframe 页面中引入 SheetJS（见 `bulk-upload-iframe.html` 底部注释）。仅用 CSV 则无需引入。

## 相关元素

- `#htmlupload`：上传入口（iframe 或嵌入 HTML）
- `#tablebulkupload`：预览表格
- `#buttonbulkuploadnow`：确认后插入 table
- `#textotalbulkupload`：条数/总金额或错误提示
