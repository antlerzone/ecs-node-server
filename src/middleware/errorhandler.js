function errorhandler(err, req, res, next) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err && err.code != null ? err.code : err);
  const status = err && typeof err.statusCode === 'number' ? err.statusCode : undefined;
  console.error('[errorhandler]', req.method, req.path, status != null ? status : '', msg);
  if (err && err.stack) console.error(err.stack);

  const reason = (msg && String(msg).slice(0, 500)) || 'internal server error';
  res.status(500).json({
    ok: false,
    type: 'server_error',
    message: 'internal server error',
    reason
  });
}

module.exports = errorhandler;