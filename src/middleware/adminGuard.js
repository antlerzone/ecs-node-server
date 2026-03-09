/**
 * 保护管理接口：请求头需带 x-admin-key，且与 process.env.ADMIN_API_KEY 一致
 * 未配置 ADMIN_API_KEY 时拒绝所有管理请求
 */
module.exports = function (req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    return res.status(503).json({ ok: false, message: 'admin API not configured' });
  }
  const provided = req.headers['x-admin-key'];
  if (provided !== key) {
    return res.status(403).json({ ok: false, message: 'invalid admin key' });
  }
  next();
};
