/**
 * Available Unit – public listing (no login).
 * Can show one client's units (by subdomain) or all clients' units (no subdomain).
 * Returns available/availablesoon rooms; each item has clientContact for WhatsApp (wasap.my).
 * Data from MySQL: client_profile, propertydetail, roomdetail. FK: client_id, property_id.
 */

const pool = require('../../config/db');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

async function roomHasListingScopeColumn() {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roomdetail' AND COLUMN_NAME = 'listing_scope'`
    );
    return Number(row?.n || 0) > 0;
  } catch {
    return false;
  }
}

/** @param {string[]} conditions @param {unknown[]} params @param {object} opts @param {boolean} hasCol */
function applyListingScopeFilter(conditions, params, opts, hasCol) {
  if (!hasCol) return;
  const ls = String(opts.listingScope || opts.listing_scope || '').trim().toUpperCase();
  if (ls === 'ROOM') {
    conditions.push("(COALESCE(r.listing_scope, 'room') = 'room')");
  } else if (ls === 'ENTIRE_UNIT' || ls === 'ENTIREUNIT') {
    conditions.push("r.listing_scope = 'entire_unit'");
  }
}

/** Portal country filter → propertydetail.country (MY | SG). */
function resolvePropertyCountryCode(countryRaw) {
  const c = countryRaw != null ? String(countryRaw).trim() : '';
  if (!c || c === 'ALL') return null;
  const u = c.toUpperCase();
  if (u === 'MALAYSIA' || u === 'MY') return 'MY';
  if (u === 'SINGAPORE' || u === 'SG') return 'SG';
  return null;
}

/** Restrict to buildings in MY/SG (property row). Not operator billing currency. */
function applyPropertyCountryFilter(conditions, params, opts, pAlias = 'p') {
  const code = resolvePropertyCountryCode(opts.country);
  if (!code) return;
  conditions.push(`UPPER(TRIM(COALESCE(${pAlias}.country,''))) = ?`);
  params.push(code);
}

function listingCountryLabelFromPropertyCode(code) {
  const u = String(code || '').trim().toUpperCase();
  if (u === 'MY') return 'Malaysia';
  if (u === 'SG') return 'Singapore';
  return '';
}

/** At least one image: non-empty mainphoto or non-empty JSON gallery array (roomdetail columns). */
const SQL_ROOM_HAS_IMAGE = `(
  NULLIF(TRIM(COALESCE(r.mainphoto, '')), '') IS NOT NULL
  OR COALESCE(JSON_LENGTH(r.media_gallery_json), 0) > 0
)`;

function orderClause(sort) {
  const s = String(sort || 'price_asc').toLowerCase();
  if (s === 'title_desc') return 'ORDER BY r.title_fld DESC, r.roomname ASC';
  if (s === 'title') return 'ORDER BY r.title_fld ASC, r.roomname ASC';
  if (s === 'price_desc') return 'ORDER BY r.price DESC, r.title_fld ASC';
  return 'ORDER BY r.price ASC, r.title_fld ASC';
}

/**
 * Property dropdown: building / apartment name only (no unit number).
 * Prefer apartmentname; else strip trailing unitnumber from shortname (shortname is often "Name B1-07-13a").
 */
function propertyOptionLabel(row) {
  const apt = row.apartmentname != null && String(row.apartmentname).trim() !== '' ? String(row.apartmentname).trim() : '';
  if (apt) return apt;
  let sn = row.shortname != null && String(row.shortname).trim() !== '' ? String(row.shortname).trim() : '';
  const un = row.unitnumber != null && String(row.unitnumber).trim() !== '' ? String(row.unitnumber).trim() : '';
  if (sn && un) {
    const escaped = un.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sn = sn.replace(new RegExp(`[\\s\\-]*${escaped}\\s*$`, 'i'), '').trim();
  }
  return sn || row.id;
}

/** Merge rows that share the same display label (same building). Value = comma-separated property ids. */
function buildMergedPropertyOptions(propRows, multiClient) {
  const map = new Map();
  for (const p of propRows || []) {
    const label = propertyOptionLabel(p);
    if (!label) continue;
    const key = multiClient ? `${p.client_id || ''}\t${label}` : label;
    const entry = map.get(key) || { label, ids: [] };
    if (!entry.ids.includes(p.id)) entry.ids.push(p.id);
    map.set(key, entry);
  }
  const merged = Array.from(map.values())
    .map(({ label, ids }) => ({ value: ids.join(','), label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return [{ value: 'ALL', label: 'All properties' }, ...merged];
}

/** Public UI price slider max (must match portal). */
const PRICE_RANGE_MAX = 10000;

/** propertyId may be one id or comma-separated ids (merged building filter). */
function applyPropertyIdFilter(conditions, params, propertyIdRaw) {
  const raw = propertyIdRaw === 'ALL' || !propertyIdRaw ? null : String(propertyIdRaw).trim();
  if (!raw) return;
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  if (ids.length === 1) {
    conditions.push('r.property_id = ?');
    params.push(ids[0]);
  } else {
    conditions.push(`r.property_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
}

/** 1 SGD = n MYR (portal monthly price compare). Set in env; used when priceCompareCurrency is MYR/SGD. */
function fxSgdToMyr() {
  const n = Number.parseFloat(String(process.env.FX_SGD_TO_MYR || '3.5'));
  return Number.isFinite(n) && n > 0 ? n : 3.5;
}

/**
 * MYR | SGD = convert all rooms to that currency for slider bounds; OFF/none = compare raw r.price.
 */
function parsePriceCompareCurrency(opts) {
  const raw = opts.priceCompareCurrency != null ? String(opts.priceCompareCurrency).trim().toUpperCase() : '';
  if (raw === 'OFF' || raw === 'RAW' || raw === 'NONE' || raw === '') return null;
  if (raw === 'MYR' || raw === 'SGD') return raw;
  return null;
}

/**
 * Monthly rent filter from portal slider (0 … PRICE_RANGE_MAX).
 * @param {string} rAlias - room table alias
 * @param {string | null} cpAlias - client_profile alias for operator currency (required if converting)
 */
function applyPriceRangeFilter(conditions, params, opts, rAlias = 'r', cpAlias = null) {
  let min = opts.priceMin != null ? Number(opts.priceMin) : 0;
  let max = opts.priceMax != null ? Number(opts.priceMax) : PRICE_RANGE_MAX;
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = PRICE_RANGE_MAX;
  min = Math.max(0, Math.floor(min));
  max = Math.min(PRICE_RANGE_MAX, Math.ceil(max));
  if (max < min) max = min;
  if (min <= 0 && max >= PRICE_RANGE_MAX) return;

  const cmp = parsePriceCompareCurrency(opts);
  const sgdToMyr = fxSgdToMyr();
  const myrToSgd = 1 / sgdToMyr;
  let expr;
  if (cmp && cpAlias) {
    const cur = `UPPER(TRIM(COALESCE(${cpAlias}.currency,'')))`;
    const p = `CAST(${rAlias}.price AS DECIMAL(18,4))`;
    if (cmp === 'MYR') {
      expr = `(CASE WHEN ${cur} = 'SGD' THEN ${p} * ? ELSE ${p} END)`;
    } else {
      expr = `(CASE WHEN ${cur} = 'MYR' THEN ${p} * ? ELSE ${p} END)`;
    }
  } else {
    expr = `CAST(${rAlias}.price AS DECIMAL(18,4))`;
  }

  if (min > 0) {
    conditions.push(`${expr} >= ?`);
    if (cmp && cpAlias) params.push(cmp === 'MYR' ? sgdToMyr : myrToSgd);
    params.push(min);
  }
  if (max < PRICE_RANGE_MAX) {
    conditions.push(`${expr} <= ?`);
    if (cmp && cpAlias) params.push(cmp === 'MYR' ? sgdToMyr : myrToSgd);
    params.push(max);
  }
}

function normalizeContact(contact) {
  if (!contact || !String(contact).trim()) return null;
  let digits = String(contact).trim().replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('1')) digits = '60' + digits;
  return digits || null;
}

/** Operator display name: operatordetail.title, fallback to subdomain. */
function resolveOperatorName(title, subdomain) {
  const t = (title && String(title).trim()) ? String(title).trim() : null;
  if (t) return t;
  const s = (subdomain && String(subdomain).trim()) ? String(subdomain).trim() : null;
  return s || null;
}

/**
 * Resolve client_id and client contact by subdomain (client_profile.subdomain, unique).
 * @returns {{ clientId: string, clientContact: string | null } | null } clientContact = digits only, with country code for MY (60) if 9 digits starting with 1
 */
async function getClientBySubdomain(subdomain) {
  const raw = (subdomain && String(subdomain).trim()) ? String(subdomain).trim().toLowerCase() : '';
  if (!raw) return null;
  const [rows] = await pool.query(
    'SELECT client_id, contact, currency FROM client_profile WHERE LOWER(TRIM(subdomain)) = ? LIMIT 1',
    [raw]
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  const clientId = r.client_id;
  const currency = (r.currency && String(r.currency).trim()) ? String(r.currency).trim().toUpperCase() : '';
  return { clientId, clientContact: normalizeContact(r.contact), clientCurrency: currency };
}

/**
 * List available units for a client (available=1 or availablesoon=1), with property filter and sort.
 * Same shape as roomsetting getRooms items so one API can feed both grid and list.
 * @param {string} clientId
 * @param {Object} opts - { propertyId?, sort?, page?, pageSize? }
 * @returns {Promise<{ items, properties, totalPages, currentPage, total }>}
 */
async function getList(clientId, opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const hasListingScopeCol = await roomHasListingScopeColumn();

  const keyword = (opts.keyword || opts.search || '').trim();
  const conditions = [
    'r.client_id = ?',
    'r.active = 1',
    '(r.available = 1 OR r.availablesoon = 1)',
    '(p.active = 1 OR p.id IS NULL)',
    'COALESCE(p.archived, 0) = 0',
    SQL_ROOM_HAS_IMAGE,
  ];
  const params = [clientId];
  applyPropertyIdFilter(conditions, params, propertyId);
  if (keyword.length >= 1) {
    conditions.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term);
  }
  const pcc = parsePriceCompareCurrency(opts);
  applyPropertyCountryFilter(conditions, params, opts, 'p');
  applyPriceRangeFilter(conditions, params, opts, 'r', pcc ? 'cp' : null);
  applyListingScopeFilter(conditions, params, opts, hasListingScopeCol);
  const whereSql = conditions.join(' AND ');
  const orderSql = orderClause(opts.sort || 'price_asc');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const lsCol = hasListingScopeCol ? 'r.listing_scope' : 'NULL AS listing_scope';
  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.property_id,
            r.available, r.availablesoon, r.availablefrom,
            ${lsCol},
            p.shortname AS property_shortname,
            p.apartmentname AS property_apartmentname,
            p.latitude AS property_latitude,
            p.longitude AS property_longitude,
            p.country AS property_country,
            cp.currency AS client_currency,
            cd.title AS client_title,
            cd.subdomain AS client_subdomain
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       LEFT JOIN operatordetail cd ON cd.id = r.client_id
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = (rows || []).map(r => {
    let mediaGallery = r.media_gallery_json;
    if (typeof mediaGallery === 'string') {
      try {
        mediaGallery = JSON.parse(mediaGallery);
      } catch (_) {
        mediaGallery = [];
      }
    }
    if (!Array.isArray(mediaGallery)) mediaGallery = [];
    const plat = r.property_latitude != null && String(r.property_latitude).trim() !== '' ? Number(r.property_latitude) : NaN;
    const plng = r.property_longitude != null && String(r.property_longitude).trim() !== '' ? Number(r.property_longitude) : NaN;
    const hasCoords = Number.isFinite(plat) && Number.isFinite(plng) && Math.abs(plat) <= 90 && Math.abs(plng) <= 180;
    const aptName = r.property_apartmentname != null && String(r.property_apartmentname).trim() !== '' ? String(r.property_apartmentname).trim() : '';
    return {
      _id: r.id,
      id: r.id,
      roomName: r.roomname || '',
      title_fld: r.title_fld || r.roomname || '',
      description_fld: r.description_fld || '',
      remark: r.remark || '',
      price: r.price != null ? Number(r.price) : null,
      mainPhoto: r.mainphoto || null,
      mediaGallery,
      available: !!r.available,
      availablesoon: !!r.availablesoon,
      availableFrom: r.availablefrom ? (r.availablefrom instanceof Date ? r.availablefrom.toISOString().slice(0, 10) : String(r.availablefrom).slice(0, 10)) : null,
      propertyId: r.property_id,
      property: {
        _id: r.property_id,
        shortname: r.property_shortname != null ? r.property_shortname : '',
        apartmentName: aptName || null,
        latitude: hasCoords ? plat : null,
        longitude: hasCoords ? plng : null
      },
      operatorName: resolveOperatorName(r.client_title, r.client_subdomain),
      currency: (r.client_currency && String(r.client_currency).trim())
        ? String(r.client_currency).trim().toUpperCase()
        : '',
      listingScope: String(r.listing_scope || 'room') === 'entire_unit' ? 'entire_unit' : 'room',
      country: listingCountryLabelFromPropertyCode(r.property_country)
    };
  });

  const existsPriceConds = [];
  const existsPriceParams = [];
  applyPriceRangeFilter(existsPriceConds, existsPriceParams, opts, 'r', pcc ? 'cp2' : null);
  applyListingScopeFilter(existsPriceConds, existsPriceParams, opts, hasListingScopeCol);
  const existsPriceSql = existsPriceConds.length ? ` AND ${existsPriceConds.join(' AND ')}` : '';

  const countryCodeExists = resolvePropertyCountryCode(opts.country);
  const needsCp2 = !!pcc;
  const needsP2 = !!countryCodeExists;
  const existsInnerFrom = [
    'FROM roomdetail r',
    ...(needsCp2 ? ['LEFT JOIN client_profile cp2 ON cp2.client_id = r.client_id'] : []),
    ...(needsP2 ? ['LEFT JOIN propertydetail p2 ON p2.id = r.property_id'] : []),
  ].join('\n            ');
  const listCountryClause = countryCodeExists ? ' AND UPPER(TRIM(COALESCE(p2.country,\'\'))) = ?' : '';

  const propExistsParams = [clientId, clientId];
  if (countryCodeExists) propExistsParams.push(countryCodeExists);
  propExistsParams.push(...existsPriceParams);

  const [propRows] = await pool.query(
    `SELECT p.id, p.client_id, p.shortname, p.apartmentname, p.unitnumber FROM propertydetail p
       WHERE p.client_id = ? AND p.active = 1 AND COALESCE(p.archived, 0) = 0
         AND EXISTS (
           SELECT 1 ${existsInnerFrom}
            WHERE r.property_id = p.id AND r.client_id = ?
              AND r.active = 1
              AND (r.available = 1 OR r.availablesoon = 1)
              AND ${SQL_ROOM_HAS_IMAGE}${listCountryClause}${existsPriceSql}
         )
       ORDER BY COALESCE(NULLIF(TRIM(p.apartmentname), ''), p.shortname) ASC LIMIT 500`,
    propExistsParams
  );
  const properties = buildMergedPropertyOptions(propRows, false);

  return {
    items,
    properties,
    totalPages,
    currentPage: page,
    total
  };
}

/**
 * List available units from ALL clients (public page, no subdomain).
 * Each item includes clientContact for WhatsApp. Filters: propertyId?, keyword?, country? (Malaysia/Singapore → propertydetail.country).
 */
async function getDataPublic(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const keyword = (opts.keyword || opts.search || '').trim();
  const hasListingScopeCol = await roomHasListingScopeColumn();
  const pccPublic = parsePriceCompareCurrency(opts);

  const conditions = [
    'r.active = 1',
    '(r.available = 1 OR r.availablesoon = 1)',
    '(p.active = 1 OR p.id IS NULL)',
    SQL_ROOM_HAS_IMAGE,
  ];
  const params = [];
  applyPropertyIdFilter(conditions, params, propertyId);
  if (keyword.length >= 1) {
    conditions.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term);
  }
  applyPropertyCountryFilter(conditions, params, opts, 'p');
  applyPriceRangeFilter(conditions, params, opts, 'r', pccPublic ? 'cp' : null);
  applyListingScopeFilter(conditions, params, opts, hasListingScopeCol);
  const whereSql = conditions.join(' AND ');
  const orderSql = orderClause(opts.sort || 'price_asc');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const lsCol = hasListingScopeCol ? 'r.listing_scope' : 'NULL AS listing_scope';
  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.property_id,
            r.available, r.availablesoon, r.availablefrom,
            ${lsCol},
            p.shortname AS property_shortname,
            p.apartmentname AS property_apartmentname,
            p.latitude AS property_latitude,
            p.longitude AS property_longitude,
            p.country AS property_country,
            cp.contact AS client_contact,
            cp.currency AS client_currency,
            cd.title AS client_title,
            cd.subdomain AS client_subdomain
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       LEFT JOIN operatordetail cd ON cd.id = r.client_id
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = (rows || []).map(r => {
    let mediaGallery = r.media_gallery_json;
    if (typeof mediaGallery === 'string') {
      try {
        mediaGallery = JSON.parse(mediaGallery);
      } catch (_) {
        mediaGallery = [];
      }
    }
    if (!Array.isArray(mediaGallery)) mediaGallery = [];
    const plat = r.property_latitude != null && String(r.property_latitude).trim() !== '' ? Number(r.property_latitude) : NaN;
    const plng = r.property_longitude != null && String(r.property_longitude).trim() !== '' ? Number(r.property_longitude) : NaN;
    const hasCoords = Number.isFinite(plat) && Number.isFinite(plng) && Math.abs(plat) <= 90 && Math.abs(plng) <= 180;
    const aptName = r.property_apartmentname != null && String(r.property_apartmentname).trim() !== '' ? String(r.property_apartmentname).trim() : '';
    return {
      _id: r.id,
      id: r.id,
      roomName: r.roomname || '',
      title_fld: r.title_fld || r.roomname || '',
      description_fld: r.description_fld || '',
      remark: r.remark || '',
      price: r.price != null ? Number(r.price) : null,
      mainPhoto: r.mainphoto || null,
      mediaGallery,
      available: !!r.available,
      availablesoon: !!r.availablesoon,
      availableFrom: r.availablefrom ? (r.availablefrom instanceof Date ? r.availablefrom.toISOString().slice(0, 10) : String(r.availablefrom).slice(0, 10)) : null,
      propertyId: r.property_id,
      property: {
        _id: r.property_id,
        shortname: r.property_shortname != null ? r.property_shortname : '',
        apartmentName: aptName || null,
        latitude: hasCoords ? plat : null,
        longitude: hasCoords ? plng : null
      },
      clientContact: normalizeContact(r.client_contact),
      currency: (r.client_currency && String(r.client_currency).trim()) ? String(r.client_currency).trim().toUpperCase() : '',
      operatorName: resolveOperatorName(r.client_title, r.client_subdomain),
      listingScope: String(r.listing_scope || 'room') === 'entire_unit' ? 'entire_unit' : 'room',
      country: listingCountryLabelFromPropertyCode(r.property_country)
    };
  });

  const propWhere = [
    'p.active = 1',
    'r.active = 1',
    '(r.available = 1 OR r.availablesoon = 1)',
    SQL_ROOM_HAS_IMAGE,
  ];
  const propParams = [];
  if (keyword.length >= 1) {
    propWhere.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    propParams.push(term, term);
  }
  applyPropertyCountryFilter(propWhere, propParams, opts, 'p');
  applyPriceRangeFilter(propWhere, propParams, opts, 'r', pccPublic ? 'cp' : null);
  applyListingScopeFilter(propWhere, propParams, opts, hasListingScopeCol);
  const propWhereSql = propWhere.join(' AND ');
  const [propRows] = await pool.query(
    `SELECT DISTINCT p.id, p.client_id, p.shortname, p.apartmentname, p.unitnumber
       FROM propertydetail p
       INNER JOIN roomdetail r ON r.property_id = p.id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       WHERE ${propWhereSql}
       ORDER BY COALESCE(NULLIF(TRIM(p.apartmentname), ''), p.shortname) ASC LIMIT 500`,
    propParams
  );
  const properties = buildMergedPropertyOptions(propRows, true);

  return {
    items,
    properties,
    totalPages,
    currentPage: page,
    total
  };
}

/**
 * Public: one-shot data for available unit page.
 * If subdomain provided: one client's units + top-level clientContact.
 * If no subdomain: all clients' units, each item has clientContact (for WhatsApp).
 * @param {string | null} subdomain - optional; when empty, returns all clients' available units
 * @param {Object} opts - { propertyId?, sort?, page?, pageSize? }
 */
async function getData(subdomain, opts = {}) {
  const raw = (subdomain && String(subdomain).trim()) ? String(subdomain).trim().toLowerCase() : '';
  if (!raw) {
    const list = await getDataPublic(opts);
    return { ok: true, ...list };
  }
  const ctx = await getClientBySubdomain(raw);
  if (!ctx) {
    return { ok: false, reason: 'SUBDOMAIN_NOT_FOUND' };
  }
  const list = await getList(ctx.clientId, opts);
  return {
    ok: true,
    items: list.items,
    properties: list.properties,
    clientContact: ctx.clientContact,
    clientCurrency: ctx.clientCurrency || '',
    totalPages: list.totalPages,
    currentPage: list.currentPage,
    total: list.total
  };
}

module.exports = {
  getClientBySubdomain,
  getList,
  getDataPublic,
  getData
};
