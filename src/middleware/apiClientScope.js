/**
 * API 操作员数据隔离：使用 Bearer + X-API-Username 的请求只能操作 api_user.client_id 对应的 client 数据。
 * 必须在 apiAuth 之后执行；设置 req.clientId、req.client，并拒绝 body/query 中与 api_user.client_id 不一致的 clientId。
 */
const pool = require('../config/db');
const { getOperatorMasterTableName } = require('../config/operatorMasterTable');

module.exports = async function apiClientScope(req, res, next) {
  const path = (req.originalUrl || req.url || req.path || '').split('?')[0];
  if (!req.apiUser) {
    console.log('[apiClientScope] skip (no apiUser)', path);
    return next();
  }
  const clientId = req.apiUser.client_id;
  console.log('[apiClientScope]', path, 'apiUser.client_id=', clientId ?? '(null)');
  if (!clientId) {
    req.apiUserClientScoped = false;
    console.log('[apiClientScope] no client_id, next()', path);
    return next();
  }
  // Terms saas-operator: resolve by email / api_user in route; allow through so no-client sign works
  if (path.includes('terms/saas-operator')) {
    console.log('[apiClientScope] skip client check for terms/saas-operator', path);
    req.apiUserClientScoped = false;
    return next();
  }
  const bodyClientId = req.body?.clientId ?? null;
  const queryClientId = req.query?.clientId ?? null;
  const requested = bodyClientId || queryClientId;
  if (requested && String(requested).trim() !== String(clientId).trim()) {
    console.log('[apiClientScope] 403 CLIENT_SCOPE_VIOLATION', path, 'requested=', requested, 'bound=', clientId);
    return res.status(403).json({
      ok: false,
      reason: 'CLIENT_SCOPE_VIOLATION',
      message: 'API user can only access data for their bound client'
    });
  }
  const opTable = await getOperatorMasterTableName();
  const [rows] = await pool.query(
    `SELECT id, title, status, currency FROM \`${opTable}\` WHERE id = ? LIMIT 1`,
    [clientId]
  );
  if (!rows.length) {
    req.apiUserClientScoped = false;
    console.log('[apiClientScope] client not found in operator master table, next()', path, 'clientId=', clientId, 'table=', opTable);
    return next();
  }
  req.clientId = clientId;
  req.client = rows[0];
  req.apiUserClientScoped = true;
  console.log('[apiClientScope] scoped clientId=', clientId, path);
  next();
};
