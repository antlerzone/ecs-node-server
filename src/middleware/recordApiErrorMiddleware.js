/**
 * When any API response is res.json({ ok: false }), write a row to ticket table (source=api_error)
 * with page, action_clicked, function_name, api_path, reason so we can review later.
 * Frontend should send in request body: page, action, functionName (optional).
 */

const { recordApiError } = require('../modules/help/help.service');

function recordApiErrorMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && body.ok === false && req.path && req.path.startsWith('/api/')) {
      recordApiError(req, body).catch(() => {});
    }
    return originalJson(body);
  };
  next();
}

module.exports = recordApiErrorMiddleware;
