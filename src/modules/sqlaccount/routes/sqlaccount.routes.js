/**
 * SQL Account API routes (Malaysia, sql.com.my).
 * Base path: /api/sqlaccount
 * Official docs: https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const express = require('express');
const router = express.Router();
const sqlaccountrequest = require('../wrappers/sqlaccountrequest');
const agentWrapper = require('../wrappers/agent.wrapper');

/** GET /api/sqlaccount/agent - list agents (example; path may vary per SQL Account API version) */
router.get('/agent', async (req, res) => {
  const result = await agentWrapper.getAgents(req);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

/**
 * Generic request: POST /api/sqlaccount/request
 * Body: { method, path, data?, params? } — for calling any SQL Account API endpoint.
 * Use when you have the Postman collection and know exact paths.
 */
router.post('/request', async (req, res) => {
  const { method = 'get', path, data, params } = req.body || {};
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ ok: false, error: 'body.path is required' });
  }
  const result = await sqlaccountrequest({
    req,
    method,
    path: path.replace(/^\//, ''),
    data,
    params
  });
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

module.exports = router;
