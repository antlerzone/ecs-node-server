# 用 HTML iframe 触发下载（绕过 Velo 前端限制）

Wix Velo 前端里用 `document.createElement('a').click()` 或 `window.open` 经常无法触发下载。改由 **HTML 元素（iframe）** 在内部用 `<a download>` 触发即可。

## 步骤

### 1. 在 Wix 编辑器里加一个 HTML 元素

- 打开页面（例如 Saas Expenses 2）
- 从左侧 **添加** → **嵌入** → **HTML iframe**
- 把该 HTML 元素拖到页面上（可放在角落或缩小到几乎看不见）
- 选中该元素，在设置里把 **ID** 设为：`htmldownloadfile`（必须一致）

### 2. 填入 HTML 代码

在 HTML 元素的「代码」里粘贴下面整段（或使用项目里的 `html-download-helper.html` 内容）：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Download</title>
</head>
<body>
<script>
(function() {
  function base64ToBlob(b64, mime) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }
  function doDownload(filename, base64, mime) {
    var blob = base64ToBlob(base64, mime);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.click();
    URL.revokeObjectURL(url);
  }
  window.addEventListener('message', function(event) {
    var d = event.data;
    if (!d || d.type !== 'DOWNLOAD_FILE') return;
    doDownload(d.filename, d.data, d.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
})();
</script>
</body>
</html>
```

### 3. 前端逻辑（已写在 expenses-page-full.js）

- 点击「Download Template」或「Download File」时，Velo 会先尝试 `$w('#htmldownloadfile').postMessage({ type: 'DOWNLOAD_FILE', filename, data: base64, mimeType })`。
- 若页面上有 id 为 `htmldownloadfile` 的 HTML 元素，iframe 会收到消息并在**自己内部**用 `<a download>` 触发下载。
- 若没有该 HTML 元素，会自动退回用 Velo 的 `triggerDownload(blob, filename)`（在部分环境可能仍被限制）。

### 4. 多个文件

Bank 多文件时，每个文件会间隔约 200ms 依次 postMessage，避免浏览器一次弹太多下载。
