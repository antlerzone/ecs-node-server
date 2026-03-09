# 敏感文件目录（勿提交到 Git）

把 Google 服务账号 JSON 密钥放在这里，例如：

- `saas-coliving-37bdbb6f71e3.json`

然后在 `.env` 里取消注释并填写：

```bash
GOOGLE_APPLICATION_CREDENTIALS=/home/ecs-user/app/secrets/saas-coliving-37bdbb6f71e3.json
```

**本机 Windows**：把 `c:\Users\User\Downloads\saas-coliving-37bdbb6f71e3.json` 上传到服务器后放到此目录，或在服务器上创建此文件并粘贴 JSON 内容。
