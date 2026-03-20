/**
 * Property Setting – list/update properties, parking lots, new property insert,
 * owner/agreement section, occupancy check. Uses MySQL: propertydetail, parkinglot,
 * roomdetail, ownerdetail, agreementtemplate, agreement, supplierdetail.
 * FK: client_id, owner_id, management_id, internettype_id, meter_id, smartdoor_id.
 *
 * Edit utility mapping (table: propertydetail):
 *   wifi id        → column: wifi_id (not wifidetail)
 *   choose supplier → column: internettype_id
 *   wifi username  → column: wifi_username
 *   wifi password  → column: wifi_password
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

/** Normalize apartment/building name: trim, collapse spaces, title case. So "space  residency" → "Space Residency". */
function normalizeApartmentName(name) {
  if (name == null || typeof name !== 'string') return '';
  const t = name.trim().replace(/\s+/g, ' ');
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapPropertyRow(r) {
  // Edit utility "Wifi id" → propertydetail.wifi_id only (not wifidetail)
  const wifi = (r.wifi_id != null && r.wifi_id !== '') ? String(r.wifi_id) : '';
  const country = (r.country != null && String(r.country).trim()) ? String(r.country).trim().toUpperCase() : null;
  return {
    _id: r.id,
    id: r.id,
    shortname: r.shortname || '',
    unitNumber: r.unitnumber || '',
    apartmentName: r.apartmentname || null,
    country: (country === 'MY' || country === 'SG') ? country : null,
    address: r.address || '',
    percentage: r.percentage != null ? Number(r.percentage) : null,
    remark: r.remark || '',
    folder: r.folder || null,
    tnb: r.electric != null ? Number(r.electric) : null,
    saj: r.water != null && r.water !== '' ? String(r.water) : '',
    wifi,
    wifiUsername: Object.prototype.hasOwnProperty.call(r, 'wifi_username') && r.wifi_username != null ? String(r.wifi_username) : '',
    wifiPassword: Object.prototype.hasOwnProperty.call(r, 'wifi_password') && r.wifi_password != null ? String(r.wifi_password) : '',
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

  const cols = 'p.id, p.shortname, p.unitnumber, p.apartmentname, p.address, p.percentage, p.remark, p.folder, p.electric, p.water, p.wifidetail, p.wifi_id, p.internettype_id, p.management_id, p.meter_id, p.smartdoor_id, p.owner_id, p.signagreement, p.active';
  const colsWithCountry = cols + ', p.country';
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT ${colsWithCountry}
       FROM propertydetail p
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
  } catch (e) {
    const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
    if (isUnknownColumn) {
      [rows] = await pool.query(
        `SELECT ${cols}
       FROM propertydetail p
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );
    } else {
      throw e;
    }
  }

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
 * Edit utility: wifi id → wifi_id, choose supplier → internettype_id, wifi username → wifi_username, wifi password → wifi_password.
 * Uses base SELECT; if wifi_username/wifi_password exist we include them (optional columns from migration 0105).
 */
async function getProperty(clientId, propertyId) {
  if (!propertyId) return null;
  const baseCols = 'id, shortname, unitnumber, apartmentname, address, percentage, remark, folder, electric, water, wifidetail, wifi_id, internettype_id, management_id, meter_id, smartdoor_id, owner_id, signagreement, active';
  const baseColsWithCountry = baseCols + ', country';
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT ${baseColsWithCountry}, wifi_username, wifi_password FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1`,
      [propertyId, clientId]
    );
  } catch (e) {
    const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
    if (isUnknownColumn) {
      try {
        [rows] = await pool.query(
          `SELECT ${baseCols}, wifi_username, wifi_password FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1`,
          [propertyId, clientId]
        );
      } catch (e2) {
        [rows] = await pool.query(
          `SELECT ${baseCols} FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1`,
          [propertyId, clientId]
        );
      }
    } else {
      throw e;
    }
  }
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
  const rawApt = data.apartmentName ?? data.apartmentname;
  const apartmentname = rawApt != null && String(rawApt).trim() !== '' ? normalizeApartmentName(String(rawApt).trim()) : rawApt;
  const countryVal = data.country != null && String(data.country).trim() !== '' ? String(data.country).trim().toUpperCase() : null;
  const country = (countryVal === 'MY' || countryVal === 'SG') ? countryVal : null;

  const updates = [];
  const params = [];
  const fields = {
    unitnumber: data.unitNumber ?? data.unitnumber,
    apartmentname,
    country,
    electric: data.tnb != null ? data.tnb : data.electric,
    water: data.saj != null ? data.saj : data.water,
    wifi_id: data.wifi ?? data.wifi_id,
    wifi_username: data.wifiUsername ?? data.wifi_username,
    wifi_password: data.wifiPassword ?? data.wifi_password,
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

  /** Smart door: one lock = property XOR one room (same rule as roomsetting.updateRoomSmartDoor). */
  if (fields.smartdoor_id !== undefined) {
    const newSd = fields.smartdoor_id;
    if (newSd) {
      const [lockRows] = await pool.query(
        'SELECT id, client_id, active FROM lockdetail WHERE id = ? LIMIT 1',
        [newSd]
      );
      const lock = lockRows && lockRows[0];
      if (!lock || lock.client_id !== clientId || !lock.active) {
        throw new Error('INVALID_OR_INACTIVE_SMART_DOOR');
      }
      const [otherProp] = await pool.query(
        'SELECT id FROM propertydetail WHERE client_id = ? AND smartdoor_id = ? AND id != ? LIMIT 1',
        [clientId, newSd, propertyId]
      );
      if (otherProp && otherProp.length) {
        throw new Error('SMART_DOOR_ALREADY_USED_BY_PROPERTY');
      }
      const [roomUse] = await pool.query(
        'SELECT id FROM roomdetail WHERE client_id = ? AND smartdoor_id = ? LIMIT 1',
        [clientId, newSd]
      );
      if (roomUse && roomUse.length) {
        throw new Error('SMART_DOOR_ALREADY_USED_BY_ROOM');
      }
    }
  }

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
 * Insert new properties (bulk). Each item: { unitNumber, apartmentName, country? }; client_id from context.
 * apartmentName is normalized (title case, trim). country: MY | SG.
 */
async function insertProperties(clientId, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('NO_ITEMS');
  const inserted = [];
  const countryCol = 'country';
  for (const item of items) {
    const unitNumber = (item.unitNumber || item.unitnumber || '').trim();
    const rawApt = (item.apartmentName || item.apartmentname || '').trim();
    if (!unitNumber || !rawApt) continue;
    const apartmentName = normalizeApartmentName(rawApt);
    const shortname = `${apartmentName} ${unitNumber}`.trim() || apartmentName;
    const countryVal = (item.country != null && String(item.country).trim()) ? String(item.country).trim().toUpperCase() : null;
    const country = (countryVal === 'MY' || countryVal === 'SG') ? countryVal : null;
    const id = randomUUID();
    try {
      await pool.query(
        `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, ${countryCol}, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [id, clientId, shortname, unitNumber, apartmentName, country]
      );
    } catch (e) {
      const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
      if (isUnknownColumn) {
        await pool.query(
          `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
          [id, clientId, shortname, unitNumber, apartmentName]
        );
      } else {
        throw e;
      }
    }
    inserted.push({ id, shortname, unitNumber, apartmentName, country });
  }
  return { ok: true, inserted, ids: inserted.map((i) => i.id) };
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
 * Get distinct apartment/building names for dropdown (all operators).
 * Returns items { apartmentName, country } with normalized name (title case, trim) so display is
 * consistent e.g. "Space Residency | MY". Dedupe by (normalizedName, country).
 */
async function getApartmentNames(_clientId, countryFilter) {
  const country = String(countryFilter || '').trim().toUpperCase() === 'SG' ? 'SG' : (String(countryFilter || '').trim().toUpperCase() === 'MY' ? 'MY' : null);
  const whereCountry = country ? 'AND UPPER(COALESCE(NULLIF(TRIM(country), \'\'), \'MY\')) = ?' : '';
  const queryParams = country ? [country] : [];
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT DISTINCT TRIM(apartmentname) AS apartmentname, COALESCE(NULLIF(TRIM(country), ''), 'MY') AS country
       FROM propertydetail
       WHERE apartmentname IS NOT NULL AND TRIM(apartmentname) != ''
       ${whereCountry}
       ORDER BY apartmentname ASC, country ASC
       LIMIT 500`
      ,queryParams
    );
  } catch (e) {
    const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
    if (isUnknownColumn) {
      [rows] = await pool.query(
        `SELECT DISTINCT TRIM(apartmentname) AS apartmentname FROM propertydetail
         WHERE apartmentname IS NOT NULL AND TRIM(apartmentname) != ''
         ${country ? 'AND ? = \'MY\'' : ''}
         ORDER BY apartmentname ASC LIMIT 500`
        ,country ? [country] : []
      );
      rows = (rows || []).map((r) => ({ apartmentname: r.apartmentname, country: 'MY' }));
    } else {
      throw e;
    }
  }
  const seen = new Set();
  const items = [];
  for (const r of rows || []) {
    const name = (r.apartmentname || '').trim();
    if (!name) continue;
    const normalized = normalizeApartmentName(name);
    const country = (r.country === 'SG' || r.country === 'MY') ? r.country : 'MY';
    const key = `${normalized}\0${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ apartmentName: normalized, country });
  }
  items.sort((a, b) => {
    const c = (a.apartmentName || '').localeCompare(b.apartmentName || '');
    return c !== 0 ? c : (a.country || 'MY').localeCompare(b.country || 'MY');
  });
  return items;
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
  const ownerIds = new Set();
  try {
    const [junctionRows] = await pool.query(
      'SELECT owner_id FROM owner_client WHERE client_id = ?',
      [clientId]
    );
    for (const row of junctionRows || []) {
      if (row?.owner_id) ownerIds.add(row.owner_id);
    }
  } catch (_) {
    // Backward compatibility: some old schemas may not have owner_client.
  }

  // Keep behavior aligned with Contact page: include pending owners for this client.
  try {
    const [pendingRows] = await pool.query('SELECT id, approvalpending FROM ownerdetail');
    for (const row of pendingRows || []) {
      const approval = parseJson(row.approvalpending);
      if (Array.isArray(approval) && approval.some((r) => r && r.clientId === clientId && r.status === 'pending')) {
        ownerIds.add(row.id);
      }
    }
  } catch (_) {
    // Optional column/table compatibility fallback.
  }

  if (ownerIds.size === 0) return [];
  const placeholders = Array.from({ length: ownerIds.size }, () => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, ownername, email FROM ownerdetail WHERE id IN (${placeholders}) ORDER BY ownername ASC LIMIT 1000`,
    [...ownerIds]
  );
  return (rows || []).map((r) => ({ value: r.id, label: r.ownername || r.email || '(No Name)' }));
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

/**
 * Get extra utility bindings (supplier + value + slot) for a property.
 * slot: electric|water|wifi|management|extra. Used by Edit utility and expenses/bank transfer.
 */
async function getPropertySupplierExtra(clientId, propertyId) {
  if (!propertyId) return [];
  const [prop] = await pool.query('SELECT id FROM propertydetail WHERE id = ? AND client_id = ?', [propertyId, clientId]);
  if (!prop || !prop.length) return [];
  const hasSlot = await hasPropertySupplierExtraSlotColumn();
  const [rows] = await pool.query(
    hasSlot
      ? 'SELECT id, supplier_id, value, slot FROM property_supplier_extra WHERE property_id = ? ORDER BY FIELD(COALESCE(slot,"extra"), "electric", "water", "wifi", "management", "extra"), created_at ASC'
      : 'SELECT id, supplier_id, value FROM property_supplier_extra WHERE property_id = ? ORDER BY created_at ASC',
    [propertyId]
  );
  return (rows || []).map(r => ({
    id: r.id,
    supplier_id: r.supplier_id,
    value: r.value != null ? String(r.value) : '',
    slot: hasSlot ? (r.slot || 'extra') : 'extra'
  }));
}

/**
 * Save utility bindings (main four + extra). Replaces all rows in property_supplier_extra for this property.
 * items: [{ supplier_id, value, slot? }]. slot: electric|water|wifi|management|extra.
 * Updates propertydetail: electric, water from slots; wifi slot → wifi_id + internettype_id only (not wifidetail); management → management_id.
 */
async function savePropertySupplierExtra(clientId, propertyId, items) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  const [prop] = await pool.query('SELECT id FROM propertydetail WHERE id = ? AND client_id = ?', [propertyId, clientId]);
  if (!prop || !prop.length) throw new Error('PROPERTY_NOT_FOUND');
  const list = Array.isArray(items) ? items : [];
  const updates = {};
  for (const row of list) {
    const slot = (row.slot || 'extra').toLowerCase();
    const supplierId = row.supplier_id || row.supplierId;
    const value = row.value != null ? String(row.value).trim() : '';
    if (slot === 'electric') updates.electric = value;
    else if (slot === 'water') updates.water = value;
    else if (slot === 'wifi') {
      updates.wifi_id = value;
      updates.internettype_id = supplierId || null;
    } else if (slot === 'management') updates.management_id = supplierId || null;
  }
  if (Object.keys(updates).length > 0) {
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), propertyId, clientId];
    console.log('[propertysetting] savePropertySupplierExtra UPDATE propertydetail', { propertyId, setClause, updates, note: 'wifi slot → wifi_id only, not wifidetail' });
    await pool.query(`UPDATE propertydetail SET ${setClause}, updated_at = NOW() WHERE id = ? AND client_id = ?`, vals);
  }
  const wifiSlot = list.find((row) => (row.slot || '').toLowerCase() === 'wifi');
  if (wifiSlot) {
    console.log('[propertysetting] savePropertySupplierExtra wifi slot', { propertyId, value: wifiSlot.value, supplier_id: wifiSlot.supplier_id || wifiSlot.supplierId, writingTo: 'wifi_id' });
  }
  await pool.query('DELETE FROM property_supplier_extra WHERE property_id = ?', [propertyId]);
  const slotCol = await hasPropertySupplierExtraSlotColumn();
  for (const row of list) {
    const supplierId = row.supplier_id || row.supplierId;
    const value = row.value != null ? String(row.value).trim() : '';
    const slot = (row.slot || 'extra').toLowerCase();
    if (!supplierId) continue;
    const [sup] = await pool.query('SELECT id FROM supplierdetail WHERE id = ? AND client_id = ?', [supplierId, clientId]);
    if (!sup || !sup.length) continue;
    const id = randomUUID();
    const slotVal = slot === 'extra' ? 'extra' : slot;
    if (slotCol) {
      await pool.query(
        'INSERT INTO property_supplier_extra (id, property_id, supplier_id, value, slot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [id, propertyId, supplierId, value || null, slotVal]
      );
    } else {
      await pool.query(
        'INSERT INTO property_supplier_extra (id, property_id, supplier_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [id, propertyId, supplierId, value || null]
      );
    }
  }
  return { ok: true };
}

async function hasPropertySupplierExtraSlotColumn() {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_supplier_extra' AND COLUMN_NAME = 'slot'"
  );
  return rows && rows.length > 0;
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
  saveOwnerAgreement,
  getPropertySupplierExtra,
  savePropertySupplierExtra
};
