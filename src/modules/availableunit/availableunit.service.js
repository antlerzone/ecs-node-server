/**
 * Available Unit – public listing (no login).
 * Can show one client's units (by subdomain) or all clients' units (no subdomain).
 * Returns available/availablesoon rooms; each item has clientContact for WhatsApp (wasap.my).
 * Data from MySQL: client_profile, propertydetail, roomdetail. FK: client_id, property_id.
 */

const pool = require('../../config/db');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** At least one image: non-empty mainphoto or non-empty JSON gallery array (roomdetail columns). */
const SQL_ROOM_HAS_IMAGE = `(
  NULLIF(TRIM(COALESCE(r.mainphoto, '')), '') IS NOT NULL
  OR COALESCE(JSON_LENGTH(r.media_gallery_json), 0) > 0
)`;

function orderClause(sort) {
  switch (String(sort || 'title').toLowerCase()) {
    case 'title_desc':
      return 'ORDER BY r.title_fld DESC, r.roomname ASC';
    case 'price_asc':
      return 'ORDER BY r.price ASC, r.title_fld ASC';
    case 'price_desc':
      return 'ORDER BY r.price DESC, r.title_fld ASC';
    case 'title':
    default:
      return 'ORDER BY r.title_fld ASC, r.roomname ASC';
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
  if (propertyId) {
    conditions.push('r.property_id = ?');
    params.push(propertyId);
  }
  if (keyword.length >= 1) {
    conditions.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term);
  }
  const whereSql = conditions.join(' AND ');
  const orderSql = orderClause(opts.sort || 'title');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.property_id,
            r.available, r.availablesoon, r.availablefrom,
            p.shortname AS property_shortname,
            cd.title AS client_title,
            cd.subdomain AS client_subdomain
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
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
      property: r.property_shortname != null ? { shortname: r.property_shortname, _id: r.property_id } : { _id: r.property_id },
      operatorName: resolveOperatorName(r.client_title, r.client_subdomain)
    };
  });

  const [propRows] = await pool.query(
    `SELECT p.id, p.shortname FROM propertydetail p
       WHERE p.client_id = ? AND p.active = 1 AND COALESCE(p.archived, 0) = 0
         AND EXISTS (
           SELECT 1 FROM roomdetail r
            WHERE r.property_id = p.id AND r.client_id = ?
              AND r.active = 1
              AND (r.available = 1 OR r.availablesoon = 1)
              AND ${SQL_ROOM_HAS_IMAGE}
         )
       ORDER BY p.shortname ASC LIMIT 500`,
    [clientId, clientId]
  );
  const properties = [
    { value: 'ALL', label: 'All' },
    ...(propRows || []).map(p => ({ value: p.id, label: p.shortname || p.id }))
  ];

  return {
    items,
    properties,
    totalPages,
    currentPage: page,
    total
  };
}

/** Map country label to client_profile.currency for filter. */
function countryToCurrency(country) {
  const c = (country && String(country).trim()) ? String(country).trim() : '';
  if (c === 'Singapore') return 'SGD';
  if (c === 'Malaysia') return 'MYR';
  return null;
}

/**
 * List available units from ALL clients (public page, no subdomain).
 * Each item includes clientContact for WhatsApp. Filters: propertyId?, keyword?, country? (Malaysia/Singapore).
 */
async function getDataPublic(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const keyword = (opts.keyword || opts.search || '').trim();
  const currencyFilter = countryToCurrency(opts.country);

  const conditions = [
    'r.active = 1',
    '(r.available = 1 OR r.availablesoon = 1)',
    '(p.active = 1 OR p.id IS NULL)',
    SQL_ROOM_HAS_IMAGE,
  ];
  const params = [];
  if (propertyId) {
    conditions.push('r.property_id = ?');
    params.push(propertyId);
  }
  if (keyword.length >= 1) {
    conditions.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term);
  }
  if (currencyFilter) {
    conditions.push('cp.currency = ?');
    params.push(currencyFilter);
  }
  const whereSql = conditions.join(' AND ');
  const orderSql = orderClause(opts.sort || 'title');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.property_id,
            r.available, r.availablesoon, r.availablefrom,
            p.shortname AS property_shortname,
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
      property: r.property_shortname != null ? { shortname: r.property_shortname, _id: r.property_id } : { _id: r.property_id },
      clientContact: normalizeContact(r.client_contact),
      currency: (r.client_currency && String(r.client_currency).trim()) ? String(r.client_currency).trim().toUpperCase() : '',
      operatorName: resolveOperatorName(r.client_title, r.client_subdomain)
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
  if (currencyFilter) {
    propWhere.push('cp.currency = ?');
    propParams.push(currencyFilter);
  }
  const propWhereSql = propWhere.join(' AND ');
  const [propRows] = await pool.query(
    `SELECT DISTINCT p.id, p.shortname
       FROM propertydetail p
       INNER JOIN roomdetail r ON r.property_id = p.id
       LEFT JOIN client_profile cp ON cp.client_id = r.client_id
       WHERE ${propWhereSql}
       ORDER BY p.shortname ASC LIMIT 500`,
    propParams
  );
  const properties = [
    { value: 'ALL', label: 'All' },
    ...(propRows || []).map(p => ({ value: p.id, label: p.shortname || p.id }))
  ];

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
