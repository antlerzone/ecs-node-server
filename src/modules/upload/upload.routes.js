/**
 * 上传到 OSS：POST multipart/form-data，字段名 file，表单项 clientId（必填，SaaS 按租户分目录）。
 * 需 apiAuth（Wix token + X-API-Username）。返回 { ok, url } 供前端存入 feedback/ticket/ownerdetail 等。
 * 表里已是 URL 的继续保留；新上传统一走此接口进 OSS。路径：uploads/{clientId}/YYYY/MM/uuid.ext
 *
 * POST /chop：公司章上传，可选「清空背景为白色」后再上传，供 agreement 模板 {{clientchop}} 使用。
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const sharp = require('sharp');
const { uploadToOss, getSignedUrl } = require('./oss.service');

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
}).single('file');

/** POST /api/upload – 上传单个文件到 OSS，返回可访问 URL。form 需带 clientId（当前租户 id） */
router.post('/', uploadMiddleware, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
  }
  const clientId = req.body?.clientId != null ? String(req.body.clientId).trim() : null;
  if (!clientId) {
    return res.status(400).json({ ok: false, reason: 'CLIENT_ID_REQUIRED' });
  }
  const result = await uploadToOss(req.file.buffer, req.file.originalname, clientId);
  if (!result.ok) {
    const status = result.reason === 'OSS_CREDENTIAL_INVALID' ? 503 : 400;
    return res.status(status).json({ ok: false, reason: result.reason });
  }
  res.json({ ok: true, url: result.url });
});

/**
 * POST /api/upload/chop – 公司章上传。
 * form: file（必填）, clientId（必填）, makeBackgroundWhite（可选，默认 true：将透明/杂色背景压成白色后上传，便于协议 PDF 盖章清晰）。
 * 返回 { ok, url }，前端可把 url 写入 Company Setting profile.companyChop。
 */
router.post('/chop', uploadMiddleware, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
  }
  const clientId = req.body?.clientId != null ? String(req.body.clientId).trim() : null;
  if (!clientId) {
    return res.status(400).json({ ok: false, reason: 'CLIENT_ID_REQUIRED' });
  }
  const makeBackgroundWhite = req.body?.makeBackgroundWhite !== 'false' && req.body?.makeBackgroundWhite !== '0';

  let buffer = req.file.buffer;
  let filename = req.file.originalname || 'chop.png';

  if (makeBackgroundWhite && buffer.length > 0) {
    try {
      buffer = await sharp(buffer)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png()
        .toBuffer();
      filename = 'chop.png';
    } catch (err) {
      console.warn('[upload/chop] sharp flatten failed, uploading original:', err?.message || err);
    }
  }

  const result = await uploadToOss(buffer, filename, clientId);
  if (!result.ok) {
    const status = result.reason === 'OSS_CREDENTIAL_INVALID' ? 503 : 400;
    return res.status(status).json({ ok: false, reason: result.reason });
  }
  res.json({ ok: true, url: result.url });
});

/** GET /api/upload/signed-url?key=xxx – 为已有 OSS key 生成临时签名 URL（可选，表里存 key 时用） */
router.get('/signed-url', async (req, res) => {
  const key = req.query?.key;
  const result = await getSignedUrl(key, 3600);
  if (!result.ok) {
    return res.status(400).json({ ok: false, reason: result.reason });
  }
  res.json({ ok: true, url: result.url });
});

module.exports = router;
