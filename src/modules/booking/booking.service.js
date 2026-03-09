/**
 * Booking – create tenancy from Wix Booking page.
 * Uses MySQL: clientdetail (admin), staffdetail, tenantdetail, tenant_client, propertydetail,
 * roomdetail, tenancy, rentalcollection, account (type_id), parkinglot.
 * All functions that need auth use email and resolve via getAccessContextByEmail.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const { createInvoicesForRentalRecords } = require('../rentalcollection-invoice/rentalcollection-invoice.service');

/** Convert date (ISO string or Date) to MySQL datetime 'YYYY-MM-DD HH:MM:SS'. */
function toMysqlDatetime(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

// BUKKUID = 以前 Wix 的 wix_id；插入 rentalcollection 时用 account.id（通过 wix_id 查）
const BUKKUID_WIX = {
  FORFEIT_DEPOSIT: '1c7e41b6-9d57-4c03-8122-a76baad3b592',
  MAINTENANCE_FEES: 'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
  TOPUP_AIRCOND: '18ba3daf-7208-46fc-8e97-43f34e898401',
  OWNER_COMMISSION: '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
  TENANT_COMMISSION: '94b4e060-3999-4c76-8189-f969615c0a7d',
  RENTAL_INCOME: 'cf4141b1-c24e-4fc1-930e-cfea4329b178',
  REFERRAL_FEES: 'e4fd92bb-de15-4ca0-9c6b-05e410815c58',
  PARKING_FEES: 'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00',
  MANAGEMENT_FEES: '620b2d43-4b3a-448f-8a5b-99eb2c3209c7',
  DEPOSIT: 'd3f72d51-c791-4ef0-aeec-3ed1134e5c86',
  AGREEMENT_FEES: '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
  OWNER_PAYOUT: 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3',
  OTHER: 'bf502145-6ec8-45bd-a703-13c810cfe186'
};

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function getAccountIdByWixId(wixId) {
  if (!wixId) return null;
  const [rows] = await pool.query('SELECT id FROM account WHERE wix_id = ? LIMIT 1', [wixId]);
  return rows[0] ? rows[0].id : null;
}

async function requireCtx(email, permissionKey = 'booking') {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx || !ctx.ok) throw new Error(ctx?.reason || 'ACCESS_DENIED');
  const perms = ctx.staff?.permission || {};
  if (!perms[permissionKey] && !perms.admin) throw new Error('NO_PERMISSION');
  if (!ctx.client?.id) throw new Error('NO_CLIENT_ID');
  return ctx;
}

/**
 * Get client admin rules (clientdetail.admin JSON).
 */
async function getAdminRules(email) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query('SELECT admin FROM clientdetail WHERE id = ? LIMIT 1', [ctx.client.id]);
  const admin = rows[0] ? parseJson(rows[0].admin) : null;
  return { ok: true, admin };
}

/**
 * Get current staff (from access context).
 */
async function getStaff(email) {
  const ctx = await requireCtx(email);
  return { ok: true, staff: ctx.staff };
}

/**
 * Available rooms: client's properties, rooms with active=1 (client) and available=1 or availablesoon=1 (system).
 * available is system-only (set by booking/tenancy); client only controls active in Room Setting.
 */
async function getAvailableRooms(email, keyword = '') {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;

  const [propertyRows] = await pool.query(
    'SELECT id FROM propertydetail WHERE client_id = ? LIMIT 1000',
    [clientId]
  );
  const propertyIds = propertyRows.map((p) => p.id);
  if (!propertyIds.length) {
    return { ok: true, items: [], message: 'No property' };
  }

  const placeholders = propertyIds.map(() => '?').join(',');
  let sql = `SELECT id, title_fld, price, property_id FROM roomdetail WHERE client_id = ? AND property_id IN (${placeholders}) AND (active = 1) AND (available = 1 OR availablesoon = 1)`;
  const params = [clientId, ...propertyIds];

  if (keyword && String(keyword).trim()) {
    sql += ' AND (title_fld LIKE ? OR roomname LIKE ?)';
    const k = `%${String(keyword).trim()}%`;
    params.push(k, k);
  }
  sql += ' ORDER BY title_fld ASC LIMIT 500';

  const [roomRows] = await pool.query(sql, params);
  const items = roomRows.map((r) => ({ _id: r.id, title_fld: r.title_fld || '', value: r.id, label: r.title_fld || r.id }));
  return { ok: true, items };
}

/**
 * Search tenants by email/phone contains keyword.
 */
async function searchTenants(email, keyword) {
  await requireCtx(email);
  if (!keyword || String(keyword).trim().length < 2) {
    return { ok: true, items: [] };
  }
  const k = `%${String(keyword).trim().toLowerCase()}%`;
  const [rows] = await pool.query(
    'SELECT id, fullname, email, phone FROM tenantdetail WHERE LOWER(COALESCE(email,"")) LIKE ? OR LOWER(COALESCE(phone,"")) LIKE ? ORDER BY fullname ASC LIMIT 100',
    [k, k]
  );
  const items = rows.map((t) => ({
    _id: t.id,
    fullname: t.fullname || '',
    email: t.email || '',
    phone: t.phone || '',
    label: `${t.fullname || ''} (${t.email || t.phone || ''})`.trim(),
    value: t.id
  }));
  return { ok: true, items };
}

/**
 * Get single tenant by id.
 */
async function getTenant(email, tenantId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, fullname, email, phone FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows.length) throw new Error('TENANT_NOT_FOUND');
  const t = rows[0];
  return {
    ok: true,
    tenant: { _id: t.id, fullname: t.fullname || '', email: t.email || '', phone: t.phone || '' }
  };
}

/**
 * Check if tenant is approved for client (exists in tenant_client).
 */
async function isTenantApprovedForClient(tenantId, clientId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM tenant_client WHERE tenant_id = ? AND client_id = ? LIMIT 1',
    [tenantId, clientId]
  );
  return rows.length > 0;
}

/**
 * Ensure tenant exists and approval state; add pending request if needed. Returns { tenant, alreadyApproved }.
 */
async function ensureTenantForBooking(email, { tenantId, email: tenantEmail }) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  let tenant;
  let alreadyApproved = false;

  if (tenantId) {
    const [rows] = await pool.query('SELECT id, fullname, email, phone, approval_request_json FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
    if (!rows.length) throw new Error('TENANT_NOT_FOUND');
    tenant = rows[0];
    alreadyApproved = await isTenantApprovedForClient(tenant.id, clientId);
    if (!alreadyApproved) {
      const arr = parseJson(tenant.approval_request_json) || [];
      const hasPending = arr.some((r) => r.clientId === clientId && r.status === 'pending');
      if (!hasPending) {
        arr.push({ clientId, status: 'pending', createdAt: new Date().toISOString() });
        await pool.query('UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?', [
          JSON.stringify(arr),
          tenant.id
        ]);
      }
    }
    return { ok: true, tenant: { _id: tenant.id, fullname: tenant.fullname, email: tenant.email, phone: tenant.phone }, alreadyApproved };
  }

  const emailNorm = (tenantEmail || '').trim().toLowerCase();
  if (!emailNorm) throw new Error('TENANT_EMAIL_REQUIRED');

  const [existing] = await pool.query('SELECT id, fullname, email, phone, approval_request_json FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [emailNorm]);
  if (existing.length) {
    tenant = existing[0];
    alreadyApproved = await isTenantApprovedForClient(tenant.id, clientId);
    if (!alreadyApproved) {
      const arr = parseJson(tenant.approval_request_json) || [];
      const hasPending = arr.some((r) => r.clientId === clientId && r.status === 'pending');
      if (!hasPending) {
        arr.push({ clientId, status: 'pending', createdAt: new Date().toISOString() });
        await pool.query('UPDATE tenantdetail SET approval_request_json = ?, updated_at = NOW() WHERE id = ?', [
          JSON.stringify(arr),
          tenant.id
        ]);
      }
    }
    return { ok: true, tenant: { _id: tenant.id, fullname: tenant.fullname, email: tenant.email, phone: tenant.phone }, alreadyApproved };
  }

  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const approvalRequest = JSON.stringify([{ clientId, status: 'pending', createdAt: new Date().toISOString() }]);
  await pool.query(
    'INSERT INTO tenantdetail (id, email, fullname, phone, approval_request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, emailNorm, '', '', approvalRequest, now, now]
  );
  return { ok: true, tenant: { _id: id, fullname: '', email: emailNorm, phone: '' }, alreadyApproved: false };
}

/**
 * Get room by id (roomdetail.price).
 */
async function getRoom(email, roomId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, title_fld, price, property_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [roomId, ctx.client.id]
  );
  if (!rows.length) throw new Error('ROOM_NOT_FOUND');
  const r = rows[0];
  return { ok: true, room: { _id: r.id, title_fld: r.title_fld, price: r.price, property_id: r.property_id } };
}

/**
 * Parking lots by property.
 */
async function getParkingLotsByProperty(email, propertyId) {
  const ctx = await requireCtx(email);
  const [rows] = await pool.query(
    'SELECT id, parkinglot FROM parkinglot WHERE client_id = ? AND property_id = ? ORDER BY parkinglot ASC',
    [ctx.client.id, propertyId]
  );
  const items = rows.map((p) => ({ _id: p.id, parkinglot: p.parkinglot || '', value: p.id, label: p.parkinglot || p.id }));
  return { ok: true, items };
}

/**
 * Create booking: tenancy insert, optional generate rental, lock room, lock parking.
 */
async function createBooking(email, payload) {
  const ctx = await requireCtx(email);
  const clientId = ctx.client.id;
  const staffId = ctx.staff?.id;
  if (!staffId) throw new Error('NO_STAFF');

  const {
    tenantIdSelected,
    emailInput,
    roomId,
    beginDate,
    endDate,
    rental,
    deposit,
    agreementFees,
    parkingFees,
    selectedParkingLots = [],
    addOns = [],
    billingBlueprint = [],
    commissionSnapshot = [],
    adminRules
  } = payload;

  if (!roomId || !beginDate || !endDate) throw new Error('ROOM_AND_DATES_REQUIRED');

  const beginMysql = toMysqlDatetime(beginDate);
  const endMysql = toMysqlDatetime(endDate);
  if (!beginMysql || !endMysql) throw new Error('INVALID_BEGIN_OR_END_DATE');

  const tenantRes = await ensureTenantForBooking(email, {
    tenantId: tenantIdSelected || null,
    email: emailInput || null
  });
  const tenantObj = tenantRes.tenant;
  const alreadyApproved = tenantRes.alreadyApproved;

  const [roomRows] = await pool.query('SELECT id, title_fld, property_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1', [roomId, clientId]);
  if (!roomRows.length) throw new Error('ROOM_NOT_FOUND');
  const room = roomRows[0];
  const title = `${tenantObj.fullname || tenantObj.email} - ${room.title_fld}`;
  const tenancyStatus = alreadyApproved ? 'active' : 'pending_approval';
  const now = new Date();

  const tenancyId = randomUUID();
  const tenancyNow = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const tenancyStatusJson = JSON.stringify([
    { key: 'contact_approval', label: 'Pending contact approval', status: alreadyApproved ? 'completed' : 'pending', updatedAt: now }
  ]);
  const remarkJson = JSON.stringify([{ type: 'booking_created', by: staffId, at: now, note: 'Booking created by admin' }]);

  await pool.query(
    `INSERT INTO tenancy (id, tenant_id, room_id, client_id, submitby_id, begin, \`end\`, rental, deposit, title, status,
     parkinglot_json, addons_json, billing_json, commission_snapshot_json, billing_generated, tenancy_status_json, remark_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      tenancyId,
      tenantObj._id,
      roomId,
      clientId,
      staffId,
      beginMysql,
      endMysql,
      rental || 0,
      deposit || 0,
      title,
      Array.isArray(selectedParkingLots) ? JSON.stringify(selectedParkingLots) : null,
      Array.isArray(addOns) ? JSON.stringify(addOns) : null,
      Array.isArray(billingBlueprint) ? JSON.stringify(billingBlueprint) : null,
      Array.isArray(commissionSnapshot) ? JSON.stringify(commissionSnapshot) : null,
      tenancyStatusJson,
      remarkJson,
      tenancyNow,
      tenancyNow
    ]
  );

  if (alreadyApproved) {
    await generateFromTenancy(email, tenancyId);
  }

  await pool.query('UPDATE roomdetail SET available = 0, availablesoon = 0, updated_at = NOW() WHERE id = ?', [roomId]);
  for (const parkingId of selectedParkingLots) {
    await pool.query('UPDATE parkinglot SET available = 0, updated_at = NOW() WHERE id = ?', [parkingId]);
  }

  return { ok: true, tenancyId };
}

/**
 * Generate RentalCollection from tenancy.billing_json; set billing_generated = 1.
 */
async function generateFromTenancy(email, tenancyId) {
  const ctx = await requireCtx(email);
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, billing_json, billing_generated, title FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
    [tenancyId, ctx.client.id]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];
  const billing = parseJson(tenancy.billing_json);
  if (!Array.isArray(billing) || !billing.length) {
    return { ok: true, inserted: 0 };
  }

  const [existing] = await pool.query('SELECT id FROM rentalcollection WHERE tenancy_id = ? LIMIT 1', [tenancyId]);
  if (existing.length) return { ok: true, inserted: 0, message: 'ALREADY_GENERATED' };

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;

  const records = [];
  for (const item of billing) {
    const wixId = item.bukkuid || item.type_id;
    const typeId = wixId ? await getAccountIdByWixId(wixId) : null;
    if (!typeId && wixId) continue; // skip if account not found for this wix_id
    const id = randomUUID();
    const dateVal = item.dueDate ? (item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate)) : null;
    const dateStr = dateVal ? dateVal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null;
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const isOwnerCommission = typeId && (await getAccountIdByWixId(BUKKUID_WIX.OWNER_COMMISSION)) === typeId;
    records.push({
      id,
      tenancy_id: tenancyId,
      tenant_id: tenancy.tenant_id,
      room_id: tenancy.room_id,
      property_id: propertyId,
      client_id: tenancy.client_id,
      type_id: typeId,
      amount: item.amount,
      date: dateStr,
      title: `${item.type} - ${tenancy.title}`,
      ispaid: isOwnerCommission ? 1 : 0,
      created_at: now,
      updated_at: now
    });
  }

  if (records.length) {
    const conn = await pool.getConnection();
    try {
      for (const r of records) {
        await conn.query(
          `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
        );
      }
      await conn.query('UPDATE tenancy SET billing_generated = 1, updated_at = NOW() WHERE id = ?', [tenancyId]);
      try {
        await createInvoicesForRentalRecords(tenancy.client_id, records);
      } catch (e) {
        console.warn('createInvoicesForRentalRecords failed:', e?.message || e);
      }
    } finally {
      conn.release();
    }
  }

  return { ok: true, inserted: records.length };
}

/**
 * Generate RentalCollection from tenancy.billing_json by tenancyId and tenantId.
 * Used by tenant dashboard after verifying tenancy belongs to tenant. No staff auth.
 */
async function generateFromTenancyByTenancyId(tenancyId, tenantId) {
  const [tenancyRows] = await pool.query(
    'SELECT id, tenant_id, room_id, client_id, billing_json, billing_generated, title FROM tenancy WHERE id = ? AND tenant_id = ? LIMIT 1',
    [tenancyId, tenantId]
  );
  if (!tenancyRows.length) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = tenancyRows[0];
  const billing = parseJson(tenancy.billing_json);
  if (!Array.isArray(billing) || !billing.length) {
    return { ok: true, inserted: 0 };
  }

  const [existing] = await pool.query('SELECT id FROM rentalcollection WHERE tenancy_id = ? LIMIT 1', [tenancyId]);
  if (existing.length) return { ok: true, inserted: 0, message: 'ALREADY_GENERATED' };

  const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
  const propertyId = roomRows[0] ? roomRows[0].property_id : null;

  const records = [];
  for (const item of billing) {
    const wixId = item.bukkuid || item.type_id;
    const typeId = wixId ? await getAccountIdByWixId(wixId) : null;
    if (!typeId && wixId) continue;
    const id = randomUUID();
    const dateVal = item.dueDate ? (item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate)) : null;
    const dateStr = dateVal ? dateVal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null;
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const isOwnerCommission = typeId && (await getAccountIdByWixId(BUKKUID_WIX.OWNER_COMMISSION)) === typeId;
    records.push({
      id,
      tenancy_id: tenancyId,
      tenant_id: tenancy.tenant_id,
      room_id: tenancy.room_id,
      property_id: propertyId,
      client_id: tenancy.client_id,
      type_id: typeId,
      amount: item.amount,
      date: dateStr,
      title: `${item.type} - ${tenancy.title}`,
      ispaid: isOwnerCommission ? 1 : 0,
      created_at: now,
      updated_at: now
    });
  }

  if (records.length) {
    const conn = await pool.getConnection();
    try {
      for (const r of records) {
        await conn.query(
          `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.tenancy_id, r.tenant_id, r.room_id, r.property_id, r.client_id, r.type_id, r.amount, r.date, r.title, r.ispaid, r.created_at, r.updated_at]
        );
      }
      await conn.query('UPDATE tenancy SET billing_generated = 1, updated_at = NOW() WHERE id = ?', [tenancyId]);
      try {
        await createInvoicesForRentalRecords(tenancy.client_id, records);
      } catch (e) {
        console.warn('createInvoicesForRentalRecords failed:', e?.message || e);
      }
    } finally {
      conn.release();
    }
  }

  return { ok: true, inserted: records.length };
}

module.exports = {
  getAdminRules,
  getStaff,
  getAvailableRooms,
  searchTenants,
  getTenant,
  getRoom,
  getParkingLotsByProperty,
  createBooking,
  generateFromTenancy,
  generateFromTenancyByTenancyId,
  BUKKUID_WIX,
  getAccountIdByWixId
};
