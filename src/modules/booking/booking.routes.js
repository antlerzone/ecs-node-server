/**
 * Booking API – for Wix Booking page.
 * All endpoints require email (body or query) and booking permission.
 */

const express = require('express');
const router = express.Router();
const {
  getAdminRules,
  getStaff,
  getAvailableRooms,
  searchTenants,
  getTenant,
  lookupTenantForBooking,
  getRoom,
  getParkingLotsByProperty,
  createBooking,
  generateFromTenancy
} = require('./booking.service');

function getEmail(req) {
  return req?.body?.email ?? req?.query?.email ?? null;
}

function withEmail(req, res, handler) {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  handler(email, req.body || {})
    .then((result) => res.json(result))
    .catch((err) => {
      const msg = err?.message || 'BACKEND_ERROR';
      if (msg === 'ACCESS_DENIED' || msg === 'NO_PERMISSION' || msg === 'NO_CLIENT_ID') {
        return res.status(403).json({ ok: false, reason: msg });
      }
      if (
        msg === 'HANDOVER_CARD_PHOTO_REQUIRED' ||
        msg === 'HANDOVER_UNIT_PHOTO_REQUIRED' ||
        msg === 'HANDOVER_TENANT_SIGNATURE_REQUIRED' ||
        msg === 'PARKING_NOT_AVAILABLE'
      ) {
        return res.status(400).json({ ok: false, reason: msg });
      }
      if (msg === 'TENANT_NOT_FOUND' || msg === 'ROOM_NOT_FOUND' || msg === 'TENANCY_NOT_FOUND') {
        return res.status(404).json({ ok: false, reason: msg });
      }
      console.error('[booking]', err);
      res.status(500).json({ ok: false, reason: msg });
    });
}

router.post('/admin-rules', (req, res) => {
  withEmail(req, res, (email) => getAdminRules(email));
});
router.post('/staff', (req, res) => {
  withEmail(req, res, (email) => getStaff(email));
});
router.post('/available-rooms', (req, res) => {
  const email = getEmail(req);
  if (!email || !String(email).trim()) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  getAvailableRooms(email, req.body?.keyword || '')
    .then((r) => res.json(r))
    .catch((err) => {
      console.error('[booking] available-rooms', err);
      res.status(500).json({ ok: false, reason: err?.message || 'BACKEND_ERROR' });
    });
});
router.post('/search-tenants', (req, res) => {
  withEmail(req, res, (email, body) => searchTenants(email, body.keyword || ''));
});
router.post('/tenant', (req, res) => {
  withEmail(req, res, (email, body) => getTenant(email, body.tenantId));
});
router.post('/lookup-tenant', (req, res) => {
  withEmail(req, res, (email, body) => lookupTenantForBooking(email, body.tenantEmail ?? body.emailInput ?? ''));
});
router.post('/room', (req, res) => {
  withEmail(req, res, (email, body) => getRoom(email, body.roomId));
});
router.post('/parking-by-property', (req, res) => {
  withEmail(req, res, (email, body) => getParkingLotsByProperty(email, body.propertyId));
});
router.post('/create', (req, res) => {
  withEmail(req, res, (email, body) => createBooking(email, body));
});
router.post('/generate-rental', (req, res) => {
  withEmail(req, res, (email, body) => generateFromTenancy(email, body.tenancyId));
});

module.exports = router;
