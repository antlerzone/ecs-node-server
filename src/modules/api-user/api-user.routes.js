/**
 * API 用户管理：需带 x-admin-key 头。Create 时手动填 username，token 自动生成；密码可单独 create/edit/delete/modify
 */
const express = require('express');
const router = express.Router();
const adminGuard = require('../../middleware/adminGuard');
const apiUserService = require('./api-user.service');

router.use(adminGuard);

/** GET /api/admin/api-users - 列表 */
router.get('/', async (req, res, next) => {
  try {
    const list = await apiUserService.list();
    res.json({ ok: true, items: list });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/api-users - 新增：body { username, password? }，token 自动生成 */
router.post('/', async (req, res, next) => {
  try {
    const username = req.body?.username;
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ ok: false, message: 'username required' });
    }
    const existing = await apiUserService.list();
    if (existing.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
      return res.status(409).json({ ok: false, message: 'username already exists' });
    }
    const user = await apiUserService.create({
      username: username.trim(),
      password: req.body?.password
    });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/api-users/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const user = await apiUserService.getById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'api user not found' });
    res.json({ ok: true, user });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/api-users/:id - 改 username / status */
router.patch('/:id', async (req, res, next) => {
  try {
    const user = await apiUserService.getById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'api user not found' });
    const updated = await apiUserService.update(req.params.id, {
      username: req.body?.username,
      status: req.body?.status
    });
    res.json({ ok: true, user: updated });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/api-users/:id/password - 修改密码 */
router.patch('/:id/password', async (req, res, next) => {
  try {
    const user = await apiUserService.getById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'api user not found' });
    const newPassword = req.body?.password;
    if (newPassword === undefined || newPassword === null) {
      return res.status(400).json({ ok: false, message: 'password required' });
    }
    await apiUserService.updatePassword(req.params.id, String(newPassword));
    res.json({ ok: true, message: 'password updated' });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/api-users/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const user = await apiUserService.getById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'api user not found' });
    await apiUserService.remove(req.params.id);
    res.json({ ok: true, message: 'deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
