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

const PREMISES_TYPES = new Set(['landed', 'apartment', 'other', 'office', 'commercial']);

const SECURITY_SYSTEMS = new Set(['icare', 'ecommunity', 'veemios', 'gprop', 'css']);

/** Lowercase known security_system values; unknown non-empty strings pass through for legacy rows. */
function normalizeSecuritySystemForDb(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (SECURITY_SYSTEMS.has(s)) return s;
  return s;
}

/**
 * Build storable credentials object for `security_system_credentials_json` (single system).
 * @param {string} systemRaw
 * @param {object} payload
 * @returns {object|null}
 */
function buildSecurityCredentialsObject(systemRaw, payload) {
  const system = normalizeSecuritySystemForDb(systemRaw);
  if (!system || !payload || typeof payload !== 'object') return null;
  const p = payload;
  if (system === 'icare') {
    const phoneNumber = String(p.phoneNumber ?? p.phone ?? '').trim();
    const dateOfBirth = String(p.dateOfBirth ?? p.dob ?? '').trim();
    const password = p.password != null ? String(p.password) : '';
    if (!phoneNumber || !dateOfBirth || !password) return null;
    return { phoneNumber, dateOfBirth, businessTimeZone: 'Asia/Kuala_Lumpur', password };
  }
  if (system === 'ecommunity') {
    const username = String(p.username ?? p.user ?? '').trim();
    const password = p.password != null ? String(p.password) : '';
    if (!username || !password) return null;
    return { username, password };
  }
  if (system === 'veemios' || system === 'gprop') {
    const userId = String(p.userId ?? p.user_id ?? '').trim();
    const password = p.password != null ? String(p.password) : '';
    if (!userId || !password) return null;
    return { userId, password };
  }
  if (system === 'css') {
    const loginCode = String(p.loginCode ?? p.login_code ?? '').trim();
    const password = p.password != null ? String(p.password) : '';
    if (!loginCode || !password) return null;
    return { loginCode, password };
  }
  return null;
}

async function tryUpdateSecuritySystemCredentialsJson(clientId, propertyId, jsonStr) {
  try {
    await pool.query(
      'UPDATE propertydetail SET security_system_credentials_json = ? WHERE id = ? AND client_id = ?',
      [jsonStr, propertyId, clientId]
    );
  } catch (e) {
    const unknown =
      e.code === 'ER_BAD_FIELD_ERROR' ||
      e.errno === 1054 ||
      (e.message && String(e.message).includes('Unknown column'));
    if (!unknown) throw e;
  }
}

/** Coliving `premises_type` — must match `cln_property.premises_type` vocabulary. */
function normalizePremisesType(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  return PREMISES_TYPES.has(s) ? s : null;
}

/** WGS84 pair for `propertydetail.latitude` / `longitude`; both null or both finite (aligned with `cln_property`). */
function wgs84FromPayload(data) {
  if (!data || typeof data !== 'object') return undefined;
  const hasAny =
    ['latitude', 'longitude', 'lat', 'lng', 'lon'].some((k) => Object.prototype.hasOwnProperty.call(data, k));
  if (!hasAny) return undefined;
  const laRaw = Object.prototype.hasOwnProperty.call(data, 'latitude')
    ? data.latitude
    : Object.prototype.hasOwnProperty.call(data, 'lat')
      ? data.lat
      : undefined;
  const loRaw = Object.prototype.hasOwnProperty.call(data, 'longitude')
    ? data.longitude
    : Object.prototype.hasOwnProperty.call(data, 'lng')
      ? data.lng
      : Object.prototype.hasOwnProperty.call(data, 'lon')
        ? data.lon
        : undefined;
  const empty = (v) =>
    v === undefined || v === null || (typeof v === 'string' && String(v).trim() === '');
  if (empty(laRaw) && empty(loRaw)) return { latitude: null, longitude: null };
  if (empty(laRaw) || empty(loRaw)) throw new Error('INVALID_LAT_LNG');
  const la = Number(laRaw);
  const lo = Number(loRaw);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error('INVALID_LAT_LNG');
  }
  return { latitude: la, longitude: lo };
}

/** @returns {'management_percent_gross'|'management_percent_net'|'management_percent_rental_income_only'|'management_fees_fixed'|'rental_unit'|'guarantee_return_fixed_plus_share'} */
function normalizeOwnerSettlementModel(v) {
  const s = String(v ?? 'management_percent_gross').trim().toLowerCase().replace(/-/g, '_');
  if (s === 'management_percent_net') return 'management_percent_net';
  if (s === 'management_percent_rental_income_only') return 'management_percent_rental_income_only';
  if (s === 'guarantee_return_fixed_plus_share') return 'guarantee_return_fixed_plus_share';
  if (s === 'rental_unit' || s === 'fixed_rent_to_owner') return 'rental_unit';
  if (s === 'management_fees_fixed') return 'management_fees_fixed';
  if (s === 'management_percent') return 'management_percent_gross';
  return 'management_percent_gross';
}

function mapPropertyRow(r) {
  // Edit utility "Wifi id" → propertydetail.wifi_id only (not wifidetail)
  const wifi = (r.wifi_id != null && r.wifi_id !== '') ? String(r.wifi_id) : '';
  const country = (r.country != null && String(r.country).trim()) ? String(r.country).trim().toUpperCase() : null;
  const ownerSettlementModel = normalizeOwnerSettlementModel(
    r.owner_settlement_model != null ? String(r.owner_settlement_model).trim() : 'management_percent_gross'
  );
  return {
    _id: r.id,
    id: r.id,
    shortname: r.shortname || '',
    unitNumber: r.unitnumber || '',
    apartmentName: r.apartmentname || null,
    country: (country === 'MY' || country === 'SG') ? country : null,
    address: r.address || '',
    ownerSettlementModel,
    fixedRentToOwner: r.fixed_rent_to_owner != null && r.fixed_rent_to_owner !== '' ? Number(r.fixed_rent_to_owner) : null,
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
    active: !!r.active,
    archived: !!r.archived,
    availableUnitCount: Number(r.available_unit_count || 0),
    totalRoomCount: Number(r.total_room_count || 0),
    premisesType: Object.prototype.hasOwnProperty.call(r, 'premises_type') && r.premises_type != null
      ? String(r.premises_type).trim().toLowerCase()
      : '',
    securitySystem: Object.prototype.hasOwnProperty.call(r, 'security_system') && r.security_system != null
      ? String(r.security_system).trim()
      : '',
    securityUsername: Object.prototype.hasOwnProperty.call(r, 'security_username') && r.security_username != null
      ? String(r.security_username).trim()
      : '',
    securitySystemCredentials: (() => {
      if (!Object.prototype.hasOwnProperty.call(r, 'security_system_credentials_json')) return null;
      const raw = r.security_system_credentials_json;
      if (raw == null || raw === '') return null;
      const parsed = parseJson(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    })(),
    cleanlemonsCleaningTenantPriceMyr:
      Object.prototype.hasOwnProperty.call(r, 'cleanlemons_cleaning_tenant_price_myr') &&
      r.cleanlemons_cleaning_tenant_price_myr != null
        ? Number(r.cleanlemons_cleaning_tenant_price_myr)
        : null,
    latitude:
      Object.prototype.hasOwnProperty.call(r, 'latitude') &&
      r.latitude != null &&
      String(r.latitude).trim() !== ''
        ? Number(r.latitude)
        : null,
    longitude:
      Object.prototype.hasOwnProperty.call(r, 'longitude') &&
      r.longitude != null &&
      String(r.longitude).trim() !== ''
        ? Number(r.longitude)
        : null,
    mailboxPassword:
      Object.prototype.hasOwnProperty.call(r, 'mailbox_password') && r.mailbox_password != null
        ? String(r.mailbox_password)
        : '',
    smartdoorPassword:
      Object.prototype.hasOwnProperty.call(r, 'smartdoor_password') && r.smartdoor_password != null
        ? String(r.smartdoor_password)
        : '',
    smartdoorTokenEnabled:
      Object.prototype.hasOwnProperty.call(r, 'smartdoor_token_enabled') &&
      (r.smartdoor_token_enabled === 1 || r.smartdoor_token_enabled === true)
  };
}

async function maybeSyncPropertydetailToCleanlemonsAfter(clientId, propertyId) {
  if (!clientId || !propertyId) return;
  try {
    const { maybeSyncPropertydetailToCleanlemons } = require('../coliving-cleanlemons/coliving-cleanlemons-link.service');
    await maybeSyncPropertydetailToCleanlemons(clientId, propertyId);
  } catch (e) {
    console.warn('[propertysetting] maybeSyncPropertydetailToCleanlemons', e && (e.message || e));
  }
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
    conditions.push('(p.archived = 0 OR p.archived IS NULL)');
  } else if (filter === 'INACTIVE_ONLY') {
    conditions.push('(p.active = 0 OR p.active IS NULL)');
    conditions.push('(p.archived = 0 OR p.archived IS NULL)');
  } else if (filter === 'ARCHIVED_ONLY') {
    conditions.push('p.archived = 1');
  }
  // filter === null (ALL): show non-archived and archived together
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

  const cols = 'p.id, p.shortname, p.unitnumber, p.apartmentname, p.address, p.latitude, p.longitude, p.percentage, p.owner_settlement_model, p.fixed_rent_to_owner, p.remark, p.folder, p.electric, p.water, p.wifidetail, p.wifi_id, p.internettype_id, p.management_id, p.meter_id, p.smartdoor_id, p.owner_id, p.signagreement, p.active, p.archived';
  const colsWithCountry = cols + ', p.country';
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT ${colsWithCountry},
              COALESCE(rs.available_unit_count, 0) AS available_unit_count,
              COALESCE(rs.total_room_count, 0) AS total_room_count
       FROM propertydetail p
       LEFT JOIN (
         SELECT
           client_id,
           property_id,
           COUNT(*) AS total_room_count,
           SUM(CASE WHEN active = 1 AND available = 1 AND (availablesoon = 0 OR availablesoon IS NULL) THEN 1 ELSE 0 END) AS available_unit_count
         FROM roomdetail
         GROUP BY client_id, property_id
       ) rs ON rs.client_id = p.client_id AND rs.property_id = p.id
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
  } catch (e) {
    const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
    if (isUnknownColumn) {
      const colsLegacy = 'p.id, p.shortname, p.unitnumber, p.apartmentname, p.address, p.percentage, p.remark, p.folder, p.electric, p.water, p.wifidetail, p.wifi_id, p.internettype_id, p.management_id, p.meter_id, p.smartdoor_id, p.owner_id, p.signagreement, p.active';
      const colsLegacyCountry = colsLegacy + ', p.country';
      try {
        [rows] = await pool.query(
          `SELECT ${colsLegacyCountry},
                  COALESCE(rs.available_unit_count, 0) AS available_unit_count,
                  COALESCE(rs.total_room_count, 0) AS total_room_count
       FROM propertydetail p
       LEFT JOIN (
         SELECT
           client_id,
           property_id,
           COUNT(*) AS total_room_count,
           SUM(CASE WHEN active = 1 AND available = 1 AND (availablesoon = 0 OR availablesoon IS NULL) THEN 1 ELSE 0 END) AS available_unit_count
         FROM roomdetail
         GROUP BY client_id, property_id
       ) rs ON rs.client_id = p.client_id AND rs.property_id = p.id
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
      } catch (e2) {
        const isUnknown2 = e2.code === 'ER_BAD_FIELD_ERROR' || e2.errno === 1054 || (e2.message && String(e2.message).includes('Unknown column'));
        if (isUnknown2) {
          [rows] = await pool.query(
            `SELECT ${colsLegacy},
                    COALESCE(rs.available_unit_count, 0) AS available_unit_count,
                    COALESCE(rs.total_room_count, 0) AS total_room_count
       FROM propertydetail p
       LEFT JOIN (
         SELECT
           client_id,
           property_id,
           COUNT(*) AS total_room_count,
           SUM(CASE WHEN active = 1 AND available = 1 AND (availablesoon = 0 OR availablesoon IS NULL) THEN 1 ELSE 0 END) AS available_unit_count
         FROM roomdetail
         GROUP BY client_id, property_id
       ) rs ON rs.client_id = p.client_id AND rs.property_id = p.id
       WHERE ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
          );
        } else {
          throw e2;
        }
      }
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
    { label: 'Inactive only', value: 'INACTIVE_ONLY' },
    { label: 'Archived unit', value: 'ARCHIVED_ONLY' }
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
  /**
   * Use SELECT * so we never omit mailbox / owner_settlement / optional migrations when *any*
   * single column in a hand-built list is missing (previous fallbacks dropped mailbox_password,
   * smartdoor_*, owner_settlement_model, etc., so updates looked "unsaved" after reload).
   */
  const [rows] = await pool.query(
    'SELECT * FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
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
  const rawApt = data.apartmentName ?? data.apartmentname;
  const apartmentname = rawApt != null && String(rawApt).trim() !== '' ? normalizeApartmentName(String(rawApt).trim()) : rawApt;
  const countryVal = data.country != null && String(data.country).trim() !== '' ? String(data.country).trim().toUpperCase() : null;
  const country = (countryVal === 'MY' || countryVal === 'SG') ? countryVal : null;

  const wgs = wgs84FromPayload(data);

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
    owner_settlement_model:
      data.ownerSettlementModel !== undefined || data.owner_settlement_model !== undefined
        ? normalizeOwnerSettlementModel(data.ownerSettlementModel ?? data.owner_settlement_model)
        : undefined,
    fixed_rent_to_owner:
      data.fixedRentToOwner !== undefined || data.fixed_rent_to_owner !== undefined
        ? (() => {
            const v = data.fixedRentToOwner ?? data.fixed_rent_to_owner;
            if (v === '' || v === undefined || v === null) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          })()
        : undefined,
    percentage: data.percentage,
    address: data.address,
    remark: data.remark,
    folder: data.folder,
    owner_id: data.owner_id ?? data.ownername,
    active: data.active,
    premises_type:
      data.premisesType !== undefined || data.premises_type !== undefined
        ? normalizePremisesType(data.premisesType ?? data.premises_type)
        : undefined,
    security_system:
      data.securitySystem !== undefined || data.security_system !== undefined
        ? (() => {
            const s = data.securitySystem ?? data.security_system;
            if (s == null || s === '') return null;
            return normalizeSecuritySystemForDb(s);
          })()
        : undefined,
    security_username:
      data.securityUsername !== undefined || data.security_username !== undefined
        ? (() => {
            const s = data.securityUsername ?? data.security_username;
            return s == null || s === '' ? null : String(s).trim();
          })()
        : undefined,
    security_system_credentials_json: (() => {
      const hasCred =
        Object.prototype.hasOwnProperty.call(data, 'securitySystemCredentials') ||
        Object.prototype.hasOwnProperty.call(data, 'security_system_credentials_json');
      if (!hasCred) return undefined;
      const v = Object.prototype.hasOwnProperty.call(data, 'securitySystemCredentials')
        ? data.securitySystemCredentials
        : data.security_system_credentials_json;
      if (v === null) return null;
      if (v === undefined) return undefined;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return null;
        const parsed = parseJson(t);
        if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_SECURITY_CREDENTIALS');
        const sys = normalizeSecuritySystemForDb(data.securitySystem ?? data.security_system);
        if (!sys) throw new Error('INVALID_SECURITY_CREDENTIALS');
        const built = buildSecurityCredentialsObject(sys, parsed);
        if (!built) throw new Error('INVALID_SECURITY_CREDENTIALS');
        return JSON.stringify(built);
      }
      if (typeof v !== 'object') return undefined;
      const sys = normalizeSecuritySystemForDb(data.securitySystem ?? data.security_system);
      if (!sys) throw new Error('INVALID_SECURITY_CREDENTIALS');
      const built = buildSecurityCredentialsObject(sys, v);
      if (!built) throw new Error('INVALID_SECURITY_CREDENTIALS');
      return JSON.stringify(built);
    })(),
    cleanlemons_cleaning_tenant_price_myr:
      data.cleanlemonsCleaningTenantPriceMyr !== undefined ||
      data.cleanlemons_cleaning_tenant_price_myr !== undefined
        ? (() => {
            const v = data.cleanlemonsCleaningTenantPriceMyr ?? data.cleanlemons_cleaning_tenant_price_myr;
            if (v === '' || v === undefined || v === null) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          })()
        : undefined,
    mailbox_password: (() => {
      if (
        !Object.prototype.hasOwnProperty.call(data, 'mailboxPassword') &&
        !Object.prototype.hasOwnProperty.call(data, 'mailbox_password')
      ) {
        return undefined;
      }
      const v = Object.prototype.hasOwnProperty.call(data, 'mailboxPassword')
        ? data.mailboxPassword
        : data.mailbox_password;
      if (v === null || v === undefined || v === '') return null;
      return String(v);
    })(),
    smartdoor_password: (() => {
      if (
        !Object.prototype.hasOwnProperty.call(data, 'smartdoorPassword') &&
        !Object.prototype.hasOwnProperty.call(data, 'smartdoor_password')
      ) {
        return undefined;
      }
      const v = Object.prototype.hasOwnProperty.call(data, 'smartdoorPassword')
        ? data.smartdoorPassword
        : data.smartdoor_password;
      if (v === null || v === undefined || v === '') return null;
      return String(v);
    })(),
    smartdoor_token_enabled: (() => {
      if (
        !Object.prototype.hasOwnProperty.call(data, 'smartdoorTokenEnabled') &&
        !Object.prototype.hasOwnProperty.call(data, 'smartdoor_token_enabled')
      ) {
        return undefined;
      }
      const v = Object.prototype.hasOwnProperty.call(data, 'smartdoorTokenEnabled')
        ? data.smartdoorTokenEnabled
        : data.smartdoor_token_enabled;
      return v === true || v === 1 || v === '1' ? 1 : 0;
    })()
  };
  if (wgs !== undefined) {
    fields.latitude = wgs.latitude;
    fields.longitude = wgs.longitude;
  }

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
  const hasShortname = Object.prototype.hasOwnProperty.call(data, 'shortname');
  if (hasShortname) {
    const rawShortname = data.shortname;
    const shortname = rawShortname == null ? null : String(rawShortname).trim();
    updates.push('shortname = ?');
    params.push(shortname || null);
  } else if (hasUnit || hasApt) {
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
  params.push(propertyId, clientId);
  await pool.query(
    `UPDATE propertydetail SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    params
  );
  await maybeSyncPropertydetailToCleanlemonsAfter(clientId, propertyId);
  return { ok: true };
}

/**
 * Set property active flag.
 */
async function setPropertyActive(clientId, propertyId, active) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  if (!active) {
    const [ongoingRows] = await pool.query(
      `SELECT t.id
         FROM tenancy t
         INNER JOIN roomdetail r ON r.id = t.room_id AND r.client_id = t.client_id
        WHERE t.client_id = ?
          AND r.property_id = ?
          AND (t.status = 1 OR t.status IS NULL)
          AND t.\`end\` >= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
        LIMIT 1`,
      [clientId, propertyId]
    );
    if (ongoingRows && ongoingRows.length) {
      throw new Error('PROPERTY_HAS_ONGOING_TENANCY');
    }
  }
  const [r] = await pool.query('UPDATE propertydetail SET active = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [active ? 1 : 0, propertyId, clientId]);
  if (r && r.affectedRows === 0) throw new Error('PROPERTY_NOT_FOUND');
  await maybeSyncPropertydetailToCleanlemonsAfter(clientId, propertyId);
  return { ok: true };
}

async function setPropertyArchived(clientId, propertyId, archived) {
  if (!propertyId) throw new Error('NO_PROPERTY_ID');
  if (archived) {
    const [roomCountRows] = await pool.query(
      'SELECT COUNT(*) AS c FROM roomdetail WHERE client_id = ? AND property_id = ?',
      [clientId, propertyId]
    );
    const roomCount = Number(roomCountRows?.[0]?.c ?? 0);
    if (roomCount > 0) {
      throw new Error('PROPERTY_HAS_ROOMS');
    }
    const [propUtilRows] = await pool.query(
      'SELECT meter_id, smartdoor_id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
      [propertyId, clientId]
    );
    const pu = propUtilRows && propUtilRows[0];
    if (pu && pu.meter_id) {
      throw new Error('PROPERTY_HAS_METER_BOUND');
    }
    if (pu && pu.smartdoor_id) {
      throw new Error('PROPERTY_HAS_LOCK_BOUND');
    }
    const [ongoingRows] = await pool.query(
      `SELECT t.id
         FROM tenancy t
         INNER JOIN roomdetail r ON r.id = t.room_id AND r.client_id = t.client_id
        WHERE t.client_id = ?
          AND r.property_id = ?
          AND (t.status = 1 OR t.status IS NULL)
          AND t.\`end\` >= DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
        LIMIT 1`,
      [clientId, propertyId]
    );
    if (ongoingRows && ongoingRows.length) {
      throw new Error('PROPERTY_HAS_ONGOING_TENANCY');
    }
  }
  const [r] = await pool.query(
    'UPDATE propertydetail SET archived = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [archived ? 1 : 0, propertyId, clientId]
  );
  if (r && r.affectedRows === 0) throw new Error('PROPERTY_NOT_FOUND');
  if (archived) {
    await pool.query(
      'UPDATE roomdetail SET active = 0, updated_at = NOW() WHERE property_id = ? AND client_id = ?',
      [propertyId, clientId]
    );
  }
  await maybeSyncPropertydetailToCleanlemonsAfter(clientId, propertyId);
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
 * Insert new properties (bulk). Each item: { unitNumber, apartmentName, shortname?, address?, country? }; client_id from context.
 * apartmentName is normalized (title case, trim). country: MY | SG.
 */
async function insertProperties(clientId, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('NO_ITEMS');
  const inserted = [];
  const countryCol = 'country';
  for (const item of items) {
    const unitNumber = (item.unitNumber || item.unitnumber || '').trim();
    const rawApt = (item.apartmentName || item.apartmentname || '').trim();
    if (!rawApt) continue;
    const apartmentName = normalizeApartmentName(rawApt);
    const customShort = (item.shortname || item.shortName || '').trim();
    const shortname = customShort || `${apartmentName} ${unitNumber}`.trim() || apartmentName;
    const unitNumberOrNull = unitNumber || null;
    const addressFromItem = (item.address || '').trim();
    const countryVal = (item.country != null && String(item.country).trim()) ? String(item.country).trim().toUpperCase() : null;
    const country = (countryVal === 'MY' || countryVal === 'SG') ? countryVal : null;
    const settlementModel = normalizeOwnerSettlementModel(item.ownerSettlementModel ?? item.owner_settlement_model);
    let fixedRent = null;
    if (item.fixedRentToOwner !== undefined || item.fixed_rent_to_owner !== undefined) {
      const fr = item.fixedRentToOwner ?? item.fixed_rent_to_owner;
      if (fr !== '' && fr != null) {
        const n = Number(fr);
        if (Number.isFinite(n)) fixedRent = n;
      }
    }
    let pct = null;
    if (item.percentage !== undefined && item.percentage !== null && item.percentage !== '') {
      const n = Number(item.percentage);
      if (Number.isFinite(n)) pct = n;
    }
    const premisesTypeIns = normalizePremisesType(item.premisesType ?? item.premises_type);
    const secRaw = item.securitySystem ?? item.security_system;
    const securitySystemIns = secRaw === undefined ? undefined : (secRaw == null || secRaw === '' ? null : String(secRaw).trim());
    const secUserRaw = item.securityUsername ?? item.security_username;
    const securityUsernameIns = secUserRaw === undefined ? undefined : (secUserRaw == null || secUserRaw === '' ? null : String(secUserRaw).trim());
    const wgsIns = wgs84FromPayload(item);
    const id = randomUUID();
    try {
      await pool.query(
        `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, ${countryCol}, owner_settlement_model, fixed_rent_to_owner, percentage, premises_type, security_system, security_username, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [id, clientId, shortname, unitNumberOrNull, apartmentName, country, settlementModel, (settlementModel === 'management_fees_fixed' || settlementModel === 'rental_unit' || settlementModel === 'guarantee_return_fixed_plus_share') ? fixedRent : null, (settlementModel === 'management_percent_gross' || settlementModel === 'management_percent_net' || settlementModel === 'management_percent_rental_income_only' || settlementModel === 'guarantee_return_fixed_plus_share') ? pct : null, premisesTypeIns, securitySystemIns === undefined ? null : securitySystemIns, securityUsernameIns === undefined ? null : securityUsernameIns]
      );
    } catch (e) {
      const isUnknownColumn = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054 || (e.message && String(e.message).includes('Unknown column'));
      if (isUnknownColumn) {
        try {
          await pool.query(
            `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, ${countryCol}, owner_settlement_model, fixed_rent_to_owner, percentage, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
            [id, clientId, shortname, unitNumberOrNull, apartmentName, country, settlementModel, (settlementModel === 'management_fees_fixed' || settlementModel === 'rental_unit' || settlementModel === 'guarantee_return_fixed_plus_share') ? fixedRent : null, (settlementModel === 'management_percent_gross' || settlementModel === 'management_percent_net' || settlementModel === 'management_percent_rental_income_only' || settlementModel === 'guarantee_return_fixed_plus_share') ? pct : null]
          );
        } catch (e2) {
          const isUnknown2 = e2.code === 'ER_BAD_FIELD_ERROR' || e2.errno === 1054 || (e2.message && String(e2.message).includes('Unknown column'));
          if (isUnknown2) {
            try {
              await pool.query(
                `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, ${countryCol}, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                [id, clientId, shortname, unitNumberOrNull, apartmentName, country]
              );
            } catch (e3) {
              const isUnknown3 = e3.code === 'ER_BAD_FIELD_ERROR' || e3.errno === 1054 || (e3.message && String(e3.message).includes('Unknown column'));
              if (isUnknown3) {
                await pool.query(
                  `INSERT INTO propertydetail (id, client_id, shortname, unitnumber, apartmentname, active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                  [id, clientId, shortname, unitNumberOrNull, apartmentName]
                );
              } else {
                throw e3;
              }
            }
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }
    if (addressFromItem) {
      try {
        await pool.query(
          'UPDATE propertydetail SET address = ? WHERE id = ? AND client_id = ?',
          [addressFromItem, id, clientId]
        );
      } catch (eAddr) {
        const isUnknownAddr =
          eAddr.code === 'ER_BAD_FIELD_ERROR' ||
          eAddr.errno === 1054 ||
          (eAddr.message && String(eAddr.message).includes('Unknown column'));
        if (!isUnknownAddr) throw eAddr;
      }
    }
    if (wgsIns !== undefined) {
      try {
        await pool.query(
          'UPDATE propertydetail SET latitude = ?, longitude = ? WHERE id = ? AND client_id = ?',
          [wgsIns.latitude, wgsIns.longitude, id, clientId]
        );
      } catch (eW) {
        const isUnknownW =
          eW.code === 'ER_BAD_FIELD_ERROR' ||
          eW.errno === 1054 ||
          (eW.message && String(eW.message).includes('Unknown column'));
        if (!isUnknownW) throw eW;
      }
    }
    if (premisesTypeIns != null || securitySystemIns !== undefined || securityUsernameIns !== undefined) {
      try {
        const bits = [];
        const p = [];
        if (premisesTypeIns != null) {
          bits.push('premises_type = ?');
          p.push(premisesTypeIns);
        }
        if (securitySystemIns !== undefined) {
          bits.push('security_system = ?');
          p.push(securitySystemIns == null ? null : securitySystemIns);
        }
        if (securityUsernameIns !== undefined) {
          bits.push('security_username = ?');
          p.push(securityUsernameIns == null ? null : securityUsernameIns);
        }
        if (bits.length) {
          p.push(id, clientId);
          await pool.query(`UPDATE propertydetail SET ${bits.join(', ')} WHERE id = ? AND client_id = ?`, p);
        }
      } catch (eUpd) {
        const isUnknownUpd = eUpd.code === 'ER_BAD_FIELD_ERROR' || eUpd.errno === 1054 || (eUpd.message && String(eUpd.message).includes('Unknown column'));
        if (!isUnknownUpd) throw eUpd;
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(item, 'mailboxPassword') ||
      Object.prototype.hasOwnProperty.call(item, 'smartdoorPassword') ||
      Object.prototype.hasOwnProperty.call(item, 'smartdoorTokenEnabled')
    ) {
      try {
        const mb =
          item.mailboxPassword == null || item.mailboxPassword === ''
            ? null
            : String(item.mailboxPassword);
        const sdp =
          item.smartdoorPassword == null || item.smartdoorPassword === ''
            ? null
            : String(item.smartdoorPassword);
        const ste =
          item.smartdoorTokenEnabled === true ||
          item.smartdoorTokenEnabled === 1 ||
          item.smartdoorTokenEnabled === '1'
            ? 1
            : 0;
        await pool.query(
          'UPDATE propertydetail SET mailbox_password = ?, smartdoor_password = ?, smartdoor_token_enabled = ? WHERE id = ? AND client_id = ?',
          [mb, sdp, ste, id, clientId]
        );
      } catch (eKey) {
        const isUnknownKey =
          eKey.code === 'ER_BAD_FIELD_ERROR' ||
          eKey.errno === 1054 ||
          (eKey.message && String(eKey.message).includes('Unknown column'));
        if (!isUnknownKey) throw eKey;
      }
    }
    const credPayload = item.securitySystemCredentials ?? item.security_system_credentials_json;
    if (credPayload != null && typeof credPayload === 'object') {
      const sysForCred = normalizeSecuritySystemForDb(
        securitySystemIns !== undefined ? securitySystemIns : (item.securitySystem ?? item.security_system)
      );
      const built = buildSecurityCredentialsObject(sysForCred, credPayload);
      if (built) {
        await tryUpdateSecuritySystemCredentialsJson(clientId, id, JSON.stringify(built));
      }
    }
    await maybeSyncPropertydetailToCleanlemonsAfter(clientId, id);
    inserted.push({ id, shortname, unitNumber: unitNumberOrNull, apartmentName, country });
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
/** `propertydetail.electric` is DECIMAL — MySQL rejects '' in strict mode; empty UI → NULL. */
function normalizeElectricDecimalForDb(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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
    if (slot === 'electric') updates.electric = normalizeElectricDecimalForDb(value);
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
  setPropertyArchived,
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
