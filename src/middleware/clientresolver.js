const pool = require('../config/db');

module.exports = async function (req, res, next) {
  try {
    const host = req.headers.host;

    if (!host) {
      return res.status(400).json({ ok: false, message: 'missing host' });
    }

    const subdomain = host.split('.')[0];

    const [rows] = await pool.query(
      'select * from clients where subdomain = ?',
      [subdomain]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'client not found' });
    }

    req.client = rows[0];

    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};