/**
 * Owner enquiry API – owner looking for operator. No login; called via Next proxy with API auth.
 * POST /api/owner-enquiry/submit → store in owner_enquiry table.
 */

const express = require('express');
const router = express.Router();
const { submitOwnerEnquiry } = require('./owner-enquiry.service');

router.post('/submit', async (req, res, next) => {
  try {
    const result = await submitOwnerEnquiry(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
