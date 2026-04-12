# 协议预览加速：LibreOffice 常驻监听（listener）

默认每次预览都会新起一个 `soffice` 进程，冷启动约 10–30 秒，长文档更容易 504。  
若启用 **LibreOffice 常驻监听**，后端用 `unoconv` 连到已有进程做转换，可明显缩短单次转换时间（无冷启动）。

## 1. 安装 unoconv

- **RHEL / Alibaba Linux / CentOS**（需 EPEL）：`sudo dnf install unoconv` 或 `sudo yum install unoconv`
- **Debian/Ubuntu**：`sudo apt install unoconv`
- 若仓库没有，可用 pip：`pip install unoconv`（需与系统 LibreOffice 兼容）

## 2. 启动 LibreOffice 监听

任选一种方式，端口需与后端配置一致（默认 `2002`）。

**方式 A：命令行（调试用）**

```bash
soffice --headless --accept="socket,host=127.0.0.1,port=2002;urp;StarOffice.ServiceManager"
```

**方式 B：systemd（推荐生产）**

创建 `/etc/systemd/system/libreoffice-listener.service`：

```ini
[Unit]
Description=LibreOffice headless listener for docx->pdf
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/soffice --headless --accept="socket,host=127.0.0.1,port=2002;urp;StarOffice.ServiceManager"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable libreoffice-listener
sudo systemctl start libreoffice-listener
```

## 3. 后端环境变量

在运行 Node 的环境里设置：

- `USE_LIBREOFFICE_LISTENER=1`（或 `true` / `yes`）— 启用 listener 路径，用 unoconv 转换。
- `LIBREOFFICE_PORT=2002`（可选）— 与上面启动的端口一致，默认 2002。

未设置 `USE_LIBREOFFICE_LISTENER` 时，行为与之前一致：每次调用 `soffice --headless --convert-to pdf`。

## 4. 行为说明

- 启用 listener 时：先尝试用 `unoconv` 连到 `127.0.0.1:${LIBREOFFICE_PORT}` 做转换；若 `unoconv` 未安装或连接被拒，会自动回退到直接起 `soffice`。
- 未启用时：仅使用直接 `soffice`，与原有逻辑相同。
- 预览仍为「仅 LibreOffice」路径，不启用 mammoth 等其它转换方式，以保持与 Word 版式一致。
