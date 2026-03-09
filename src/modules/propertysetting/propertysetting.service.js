/**
 * Property Setting – list/update properties, parking lots, new property insert,
 * owner/agreement section, occupancy check. Uses MySQL: propertydetail, parkinglot,
 * roomdetail, ownerdetail, agreementtemplate, agreement, supplierdetail.
 * FK: client_id, owner_id, management_id, internettype_id, meter_id, smartdoor_id.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { saveOwnerAgreement: saveOwnerAgreementShared } = require('../agreement/owner-agreement.service');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

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

function mapPropertyRow(r) {
  return {
    _id: r.id,
    id: r.id,
    shortname: r.shortname || '',
    unitNumber: r.unitnumber || '',
    apartmentName: r.apartmentname || null,
    address: r.address || '',
    percentage: r.percentage != null ? Number(r.percentage) : null,
    remark: r.remark || '',
    folder: r.folder || null,
    tnb: r.electric != null ? Number(r.electric) : null,
    saj: r.water != null && r.water !== '' ? String(r.water) : '',
    wifi: r.wifidetail || r.wifi || '',
    internetType: r.internettype_id || null,
    management: r.management_id || null,
    meter: r.meter_id || null,
    smartdoor: r.smartdoor_id || null,
    owner_id: r.owner_id || null,
    signagreement: r.signagreement || null,
    active: !!r.active
  };
}

function listConditions(clientId, opts = {}) {
  const keyword = (opts.keyword || opts.search || '').trim().toLowerCase();
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const filter = opts.filter === 'ALL' || !opts.filter ? null : opts.filter;
  const conditions = ['p.client_id = ?'];
  const params = [clientId];
  if (propertyId) {
    conditions.push('p.id = ?');
    params.push(propertyId);
  }
  if (filter === 'ACTIVE_ONLY') {
    conditions.push('p.active = 1');
  } else if (filter === 'INACTIVE_ONLY') {
    conditions.push('(p.active = 0 OR p.active IS NULL)');
  }
  if (keyword && keyword.length >= 1) {
    conditions.push('(p.shortname LIKE ? OR p.apartmentname LIKE ? OR p.unitnumber LIKE ? OR p.address LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term, term, term);
  }
  return { whereSql: conditions.join(' AND '), params };
}

/**
 * List properties with filters and pagination.
 * opts: { keyword?, propertyId?, sort?, page?, pageSize?, limit? }
 */
async function getProperties(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const sort = (opts.sort || 'shortname').toLowerCase();
  const orderBy = sort === 'shortname_desc' ? 'ORDER BY p.shortname DESC, p.id ASC' : 'ORDER BY p.shortname ASC, p.id ASC';

  const { whereSql, params } = listConditions(clientId, opts);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM propertydetail p WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT p.id, p.shortname, p.unitnumber, p.apartmentname, p.address, p.percentage, p.remark, p.folder,
            p.electric, p.water, p.wifidetail, p.wifi_id, p.internettype_id, p.management_id, p.meter_id, p.smartdoor_id,
            p.owner_id, p.signagreement, p.active
       FROM propertydetail p
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = (rows || []).map(r => mapPropertyRow(r));
  return { items, totalPages, currentPage: page, total };
}

/**
 * Get filter options: properties (for dropdown) + services (e.g. Active/All).
 */
async function getPropertyFilters(clientId) {
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = (propRows || []).map(p => ({
    value: p.id,
    label: p.shortname || p.id
  }));

  const services = [
    { label: 'All', value: 'ALL' },
    { label: 'Active only', value: 'ACTIVE_ONLY' },
    { label: 'Inactive only', value: 'INACTIVE_ONLY' }
  ];

  return { properties, services };
}

/**
 * Get one property by id (for detail form).
 */
async function getProperty(clientId, propertyId) {
  if (!propertyId) return null;
  const [rows] = await pool.query(
    `SELECT id, shortname, unitnumber, apartmentname, address, percentage, remark, folder,
            electric, water, wifidetail, wifi_id, internettype_id, management_id, meter_id, smartdoor_id,
            owner_id, signagreement, active
       FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1`,
    [propertyId, clientId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return mapPropertyRow(r);
}

/**
 * Update property. Payload: unitNumber, apartmentName, tnb, saj, wifi, internetType, percentage,
 * address, remark, folder, meter, smartdoor, management, active.
 * tnb → electric, saj → water.
 */
async function updateProperty(clientId, propertyId, data) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  const [existing] = await pool.query('SELECT id FROM propertydetail WHERE id = ? AND client_id = ?', [propertyId, clientId]);
  if (!existing || !existing.length) throw new Error('PROPERTY_NOT_FOUND');

  const toFkNull = (v) => (v === undefined || v === null || v === '' || String(v) === 'null') ? null : v;
  const updates = [];
  const params = [];
  const fields = {
    unitnumber: data.unitNumber ?? data.unitnumber,
    apartmentname: data.apartmentName ?? data.apartmentname,
    electric: data.tnb != null ? data.tnb : data.electric,
    water: data.saj != null ? data.saj : data.water,
    wifidetail: data.wifi,
    internettype_id: data.internetType ?? data.internettype_id,
    management_id: data.management ?? data.management_id,
    meter_id: 'meter' in data ? toFkNull(data.meter) : (data.meter_id !== undefined ? toFkNull(data.meter_id) : undefined),
    smartdoor_id: 'smartdoor' in data ? toFkNull(data.smartdoor) : (data.smartdoor_id !== undefined ? toFkNull(data.smartdoor_id) : undefined),
    percentage: data.percentage,
    address: data.address,
    remark: data.remark,
    folder: data.folder,
    owner_id: data.owner_id ?? data.ownername,
    active: data.active
  };
  const hasUnit = fields.unitnumber !== undefined;
  const hasApt = fields.apartmentname !== undefined;
  if (hasUnit || hasApt) {
    const [prev] = await pool.query('SELECT unitnumber, apartmentname FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1', [propertyId, clientId]);
    const merged = {
      unitnumber: hasUnit ? fields.unitnumber : (prev && prev[0] ? prev[0].unitnumber : null),
      apartmentname: hasApt ? fields.apartmentname : (prev && prev[0] ? prev[0].apartmentname : null)
    };
    const shortname = `${(merged.apartmentname ?? '').toString().trim()} ${(merged.unitnumber ?? '').toString().trim()}`.trim();
    updates.push('shortname = ?');
    params.push(shortname || null);
  }

  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    if (col === 'active') {
      updates.push('active = ?');
      params.push(val ? 1 : 0);
    } else {
      updates.push(`${col} = ?`);
      params.push(val === null || val === '' ? null : val);
    }
  }
  if (updates.length === 0) return { ok: true };
  params.push(propertyId);
  await pool.query(`UPDATE propertydetail SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  return { ok: true };
}

/**
 * Set property active flag.
 */
async function setPropertyActive(clientId, propertyId, active) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  const [r] = await pool.query('UPDATE propertydetail SET active = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [active ? 1 : 0, propertyId, clientId]);
  if (r && r.affectedRows === 0) throw new Error('PROPERTY_NOT_FOUND');
  return { ok: true };
}

/**
 * Get parking lots for a property.
 */
async function getParkingLotsByProperty(clientId, propertyId) {
  if (!propertyId) return [];
  const [rows] = await pool.query(
    'SELECT id, parkinglot FROM parkinglot WHERE client_id = ? AND property_id = ? ORDER BY parkinglot ASC LIMIT 1000',
    [clientId, propertyId]
  );
  return (rows || []).map(r => ({ _id: r.id, id: r.id, parkinglot: r.parkinglot || '' }));
}

/**
 * Save parking lots: replace all slots for property with given list of names.
 */
async function saveParkingLots(clientId, propertyId, items) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  const [prop] = await pool.query('SELECT id, shortname FROM propertydetail WHERE id = ? AND client_id = ?', [propertyId, clientId]);
  if (!prop || !prop.length) throw new Error('PROPERTY_NOT_FOUND');

  const names = (items || []).map(i => (typeof i === 'string' ? i : (i && i.parkinglot) || '').trim()).filter(Boolean);

  await pool.query('DELETE FROM parkinglot WHERE client_id = ? AND property_id = ?', [clientId, propertyId]);

  const shortname = prop[0].shortname || '';
  for (const name of names) {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO parkinglot (id, client_id, property_id, parkinglot, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [id, clientId, propertyId, name]
    );
  }
  return { ok: true };
}

/**
 * Insert new properties (bulk). Each item: { unitNumber, apartmentName }; client_id from context.
 */
async function insertProperties(clientId, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('NO_ITEMS');
  const inserted = [];
  for (const item of items) {
    const unitNumber = (item.unitNumber || item.unitnumber || '').trim();
    const apartmentName = (item.apartmentName || item.apartmentname || '').trim();
    if (!unitNumber || !apartmentName) continue;
    const shortname = `${apartmentName} ${unitNumber}`.trim() || apartmentName;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [id, clientId, shortname, unitNumber, apartmentName]
    );
    inserted.push({ id, shortname, unitNumber, apartmentName });
  }
  return { ok: true, inserted };
}

/**
 * Check if property is fully occupied (all rooms under it have available = false).
 */
async function isPropertyFullyOccupied(clientId, propertyId) {
  if (!propertyId) return false;
  const [roomRows] = await pool.query(
    'SELECT id, available FROM roomdetail WHERE client_id = ? AND property_id = ? AND active = 1 LIMIT 1000',
    [clientId, propertyId]
  );
  const rooms = roomRows || [];
  if (rooms.length === 0) return false;
  const hasAnyAvailable = rooms.some(r => r.available === 1);
  return !hasAnyAvailable;
}

/**
 * Get distinct apartment names for new property dropdown.
 * Returns names from ALL clients so everyone can reuse the same name (e.g. "Space Residency")
 * and avoid variants like "Spaceresidency" / "space residency". New names are added via
 * #buttonapartmentname on the frontend, then saved with insertProperties.
 */
async function getApartmentNames(_clientId) {
  const [rows] = await pool.query(
    'SELECT DISTINCT apartmentname FROM propertydetail WHERE apartmentname IS NOT NULL AND TRIM(apartmentname) != "" ORDER BY apartmentname ASC LIMIT 500'
  );
  return (rows || []).map(r => r.apartmentname).filter(Boolean);
}

/**
 * Get suppliers for client (for wifi/management dropdowns).
 */
async function getSuppliers(clientId) {
  const [rows] = await pool.query(
    'SELECT id, title FROM supplierdetail WHERE client_id = ? ORDER BY title ASC LIMIT 1000',
    [clientId]
  );
  return (rows || []).map(r => ({ value: r.id, label: r.title || r.id }));
}

/**
 * Owner section: get owners list for dropdown.
 */
async function getOwners(clientId) {
  const [rows] = await pool.query(
    'SELECT id, ownername FROM ownerdetail WHERE client_id = ? ORDER BY ownername ASC LIMIT 1000',
    [clientId]
  );
  return (rows || []).map(r => ({ value: r.id, label: r.ownername || '(No Name)' }));
}

/**
 * Owner section: get agreement templates for mode owner_operator.
 */
async function getAgreementTemplates(clientId) {
  const [rows] = await pool.query(
    'SELECT id, title FROM agreementtemplate WHERE client_id = ? AND mode = ? ORDER BY title ASC LIMIT 500',
    [clientId, 'owner_operator']
  );
  return (rows || []).map(r => ({ value: r.id, label: r.title || r.id }));
}

/** Owner section: delegate to shared owner-agreement service (supports renewal, later credit deduction). */
async function saveOwnerAgreement(clientId, propertyId, payload) {
  return saveOwnerAgreementShared(clientId, propertyId, payload);
}

module.exports = {
  getProperties,
  getPropertyFilters,
  getProperty,
  updateProperty,
  setPropertyActive,
  getParkingLotsByProperty,
  saveParkingLots,
  insertProperties,
  isPropertyFullyOccupied,
  getApartmentNames,
  getSuppliers,
  getOwners,
  getAgreementTemplates,
  saveOwnerAgreement
};
