/**
 * Owner Setting – list properties with owner/pending, filters, search owner, save/delete owner invitation.
 * Uses MySQL: propertydetail, ownerdetail, agreementtemplate, owner_client, owner_property.
 * approvalpending (ownerdetail): JSON array of { propertyId, clientId, agreementId, status, createdAt, updatedAt }.
 * All operations require clientId from access context.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

const DEFAULT_PAGE_SIZE = 10;
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

/**
 * List this client's owners: one item per owner. Display = ownername | property A, property B
 * (only properties under this client; properties under other clients are not shown).
 * opts: { search?, page?, pageSize?, limit? }
 * Item shape: { _id, ownername: { ownerName }, properties: [{ id, shortname }], __pending?, __pendingOwner? }
 */
async function getOwnerList(clientId, opts = {}) {
  if (!clientId) return { items: [], total: 0, totalPages: 1, currentPage: 1 };

  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const search = (opts.search || '').trim();

  const [propRows] = await pool.query(
    'SELECT id, shortname, owner_id FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC',
    [clientId]
  );
  const ownerIdsFromProperties = [...new Set((propRows || []).map((p) => p.owner_id).filter(Boolean))];
  const ownerIdsLinkedToClient = new Set(ownerIdsFromProperties);
  try {
    const [fromJunction] = await pool.query('SELECT owner_id FROM owner_client WHERE client_id = ?', [clientId]);
    (fromJunction || []).forEach((r) => ownerIdsLinkedToClient.add(r.owner_id));
  } catch (_) { /* owner_client may not exist */ }
  try {
    const [fromLegacy] = await pool.query('SELECT id FROM ownerdetail WHERE client_id = ?', [clientId]);
    (fromLegacy || []).forEach((r) => ownerIdsLinkedToClient.add(r.id));
  } catch (_) { /* client_id column may not exist */ }

  const allOwnerIds = [...ownerIdsLinkedToClient];
  let ownerMap = {};
  if (allOwnerIds.length) {
    const placeholders = allOwnerIds.map(() => '?').join(',');
    const [ownerRows] = await pool.query(
      `SELECT id, ownername, email, approvalpending FROM ownerdetail WHERE id IN (${placeholders})`,
      allOwnerIds
    );
    for (const o of ownerRows || []) {
      ownerMap[o.id] = {
        _id: o.id,
        ownerName: o.ownername || '',
        email: o.email || '',
        approvalpending: parseJson(o.approvalpending) || []
      };
    }
  }

  const [allOwnersWithPending] = await pool.query(
    'SELECT id, ownername, email, approvalpending FROM ownerdetail WHERE approvalpending IS NOT NULL AND approvalpending != "" AND approvalpending != "[]"'
  );
  const pendingByProperty = new Map();
  for (const o of allOwnersWithPending || []) {
    const arr = parseJson(o.approvalpending);
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      const cid = entry.clientId || entry.clientid;
      const pid = entry.propertyId || entry.propertyid;
      if (cid === clientId && (entry.status === 'pending') && pid) {
        if (!pendingByProperty.has(pid)) {
          pendingByProperty.set(pid, {
            _id: o.id,
            ownerName: 'Pending Owner',
            email: o.email || '',
            approvalpending: arr
          });
        }
      }
    }
  }

  const propByOwner = new Map();
  for (const p of propRows || []) {
    if (p.owner_id) {
      if (!propByOwner.has(p.owner_id)) propByOwner.set(p.owner_id, []);
      propByOwner.get(p.owner_id).push({ id: p.id, shortname: p.shortname || '' });
    }
  }
  const pendingPropByOwner = new Map();
  for (const p of propRows || []) {
    if (p.owner_id) continue;
    const pending = pendingByProperty.get(p.id);
    if (!pending) continue;
    const oid = pending._id;
    if (!pendingPropByOwner.has(oid)) pendingPropByOwner.set(oid, []);
    pendingPropByOwner.get(oid).push({ id: p.id, shortname: p.shortname || '' });
  }

  // Merge by email so one row per person (same email = same owner); avoids duplicate names from multiple ownerdetail rows
  const emailToOwnerIds = new Map();
  for (const oid of allOwnerIds) {
    const o = ownerMap[oid];
    if (!o) continue;
    const key = (o.email || '').trim().toLowerCase() || `__id_${oid}`;
    if (!emailToOwnerIds.has(key)) emailToOwnerIds.set(key, []);
    emailToOwnerIds.get(key).push(oid);
  }
  const items = [];
  for (const [emailKey, oidList] of emailToOwnerIds) {
    const primaryOid = oidList[0];
    const o = ownerMap[primaryOid];
    if (!o) continue;
    const seenInGroup = new Set();
    const completedProps = [];
    const pendingProps = [];
    for (const oid of oidList) {
      for (const prop of propByOwner.get(oid) || []) {
        if (seenInGroup.has(prop.id)) continue;
        seenInGroup.add(prop.id);
        completedProps.push(prop);
      }
      for (const prop of pendingPropByOwner.get(oid) || []) {
        if (seenInGroup.has(prop.id)) continue;
        seenInGroup.add(prop.id);
        pendingProps.push(prop);
      }
    }
    const allProps = [...completedProps, ...pendingProps];
    const hasPending = pendingProps.length > 0;
    const shortnames = allProps.map((x) => x.shortname).filter(Boolean);
    items.push({
      _id: primaryOid,
      id: primaryOid,
      ownername: { ownerName: hasPending && completedProps.length === 0 ? 'Pending Owner' : (o.ownerName || o.email || 'Owner') },
      properties: allProps,
      propertiesLabel: shortnames.length ? shortnames.join(', ') : '—',
      __pending: hasPending,
      __pendingOwner: hasPending ? { _id: primaryOid, ownerName: 'Pending Owner', email: o.email, approvalpending: o.approvalpending } : null
    });
  }
  // Pending-only owners: include even when pendingProps is empty so list matches Contact Setting (e.g. pending for this client but property has owner_id set)
  for (const o of allOwnersWithPending || []) {
    if (items.some((it) => it._id === o.id)) continue;
    const key = ((o.email || '').trim().toLowerCase()) || `__id_${o.id}`;
    if (emailToOwnerIds.has(key)) continue;
    const pendingProps = pendingPropByOwner.get(o.id) || [];
    const shortnames = pendingProps.map((x) => x.shortname).filter(Boolean);
    items.push({
      _id: `pending_${o.id}`,
      id: `pending_${o.id}`,
      ownername: { ownerName: 'Pending Owner' },
      properties: pendingProps,
      propertiesLabel: shortnames.length ? shortnames.join(', ') : '—',
      __pending: true,
      __pendingOwner: { _id: o.id, ownerName: 'Pending Owner', email: o.email, approvalpending: parseJson(o.approvalpending) || [] }
    });
  }

  // Defensive: one row per owner _id (in case of duplicate ids from junction/legacy)
  const seenIds = new Set();
  const deduped = items.filter((it) => {
    const id = it._id;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  items.length = 0;
  items.push(...deduped);

  const totalBeforeSearch = items.length;
  if (search && !useLimit) {
    const lower = search.toLowerCase();
    const filtered = items.filter(
      (it) =>
        (it.ownername?.ownerName || '').toLowerCase().includes(lower) ||
        (it.propertiesLabel || '').toLowerCase().includes(lower)
    );
    items.length = 0;
    items.push(...filtered);
  }
  const total = items.length;
  const totalForPaging = useLimit ? totalBeforeSearch : total;
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(totalForPaging / pageSize));
  const offset = useLimit ? 0 : (page - 1) * pageSize;
  const slice = items.slice(offset, offset + pageSize);

  return {
    items: slice,
    total: totalForPaging,
    totalPages,
    currentPage: page
  };
}

/**
 * Get filter options: properties (for dropdown), agreementTemplates (for create owner).
 */
async function getOwnerFilters(clientId) {
  if (!clientId) return { properties: [], agreementTemplates: [] };
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = (propRows || []).map((p) => ({
    label: p.shortname || p.id,
    value: p.id
  }));
  const [tmplRows] = await pool.query(
    'SELECT id, title FROM agreementtemplate WHERE client_id = ? ORDER BY title ASC LIMIT 1000',
    [clientId]
  );
  const agreementTemplates = (tmplRows || []).map((a) => ({
    label: a.title || a.id,
    value: a.id
  }));
  return { properties, agreementTemplates };
}

/**
 * Search owner by email (keyword). Returns list of owners for checkbox group.
 */
async function searchOwnerByEmail(clientId, keyword) {
  if (!clientId || !(keyword || '').trim()) return { items: [] };
  const k = `%${String(keyword).trim().toLowerCase()}%`;
  const [rows] = await pool.query(
    'SELECT id, ownername, email FROM ownerdetail WHERE LOWER(email) LIKE ? OR LOWER(ownername) LIKE ? ORDER BY email ASC LIMIT 50',
    [k, k]
  );
  return {
    items: (rows || []).map((r) => ({
      _id: r.id,
      id: r.id,
      ownerName: r.ownername || '',
      email: r.email || ''
    }))
  };
}

/**
 * Get one property by id (for percentage / summary). Client-scoped.
 */
async function getPropertyById(clientId, propertyId) {
  if (!clientId || !propertyId) return null;
  const [rows] = await pool.query(
    'SELECT id, shortname, percentage, owner_id FROM propertydetail WHERE client_id = ? AND id = ? LIMIT 1',
    [clientId, propertyId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return { _id: r.id, id: r.id, shortname: r.shortname, percentage: r.percentage, owner_id: r.owner_id };
}

/**
 * Get agreement templates for client (for dropdown).
 */
async function getAgreementTemplates(clientId) {
  if (!clientId) return { items: [] };
  const [rows] = await pool.query(
    'SELECT id, title FROM agreementtemplate WHERE client_id = ? ORDER BY title ASC LIMIT 1000',
    [clientId]
  );
  return {
    items: (rows || []).map((r) => ({ _id: r.id, id: r.id, title: r.title }))
  };
}

/**
 * Get properties that have no owner (for dropdown when creating invitation).
 */
async function getPropertiesWithoutOwner(clientId) {
  if (!clientId) return { items: [] };
  const [rows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? AND (owner_id IS NULL OR owner_id = "") ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  return {
    items: (rows || []).map((r) => ({ _id: r.id, id: r.id, shortname: r.shortname }))
  };
}

/**
 * Save owner invitation: bind owner to property (pending until owner accepts).
 * When agreementId provided: also create/update agreement row so owner can sign in portal.
 * When agreementId omitted: only write approvalpending (section createowner = bind owner with property only).
 * payload: { ownerId?, email, propertyId, agreementId? (template id), editingPendingContext? }
 */
async function saveOwnerInvitation(clientId, payload) {
  if (!clientId || !payload) return { ok: false, reason: 'MISSING_PARAMS' };
  const { propertyId, agreementId, ownerId, email, editingPendingContext } = payload;
  if (!propertyId) return { ok: false, reason: 'MISSING_PROPERTY' };

  const [propRow] = await pool.query(
    'SELECT id, owner_id FROM propertydetail WHERE client_id = ? AND id = ? LIMIT 1',
    [clientId, propertyId]
  );
  if (!propRow || !propRow[0]) return { ok: false, reason: 'PROPERTY_NOT_FOUND' };
  if (propRow[0].owner_id) return { ok: false, reason: 'PROPERTY_ALREADY_HAS_OWNER' };

  const now = new Date();
  const agreementMode = 'owner_operator';

  let owner;
  if (ownerId) {
    const [ownerRows] = await pool.query('SELECT id, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
    if (!ownerRows || !ownerRows[0]) return { ok: false, reason: 'OWNER_NOT_FOUND' };
    owner = ownerRows[0];
  } else {
    const rawEmail = (email || '').trim();
    if (!rawEmail) return { ok: false, reason: 'MISSING_EMAIL' };
    const [existing] = await pool.query(
      'SELECT id, approvalpending FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [rawEmail.toLowerCase()]
    );
    if (existing && existing[0]) {
      owner = existing[0];
    } else {
      const id = randomUUID();
      await pool.query(
        'INSERT INTO ownerdetail (id, email, ownername, account, approvalpending, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [id, rawEmail.toLowerCase(), '', '[]', JSON.stringify([])]
      );
      const [newRow] = await pool.query('SELECT id, approvalpending FROM ownerdetail WHERE id = ? LIMIT 1', [id]);
      owner = newRow[0];
    }
  }

  let approvalpending = parseJson(owner.approvalpending) || [];
  const isEdit = editingPendingContext && editingPendingContext.propertyId === propertyId;

  let agreementRowId = null;
  if (agreementId) {
    if (isEdit) {
      const [existingRows] = await pool.query(
        `SELECT id FROM agreement WHERE owner_id = ? AND property_id = ? AND client_id = ? AND mode = ? AND status = 'pending' LIMIT 1`,
        [owner.id, propertyId, clientId, agreementMode]
      );
      if (existingRows && existingRows[0]) {
        agreementRowId = existingRows[0].id;
        await pool.query(
          `UPDATE agreement SET agreementtemplate_id = ?, updated_at = NOW() WHERE id = ?`,
          [agreementId, agreementRowId]
        );
      }
      if (!agreementRowId) {
        agreementRowId = randomUUID();
        await pool.query(
          `INSERT INTO agreement (id, client_id, property_id, owner_id, agreementtemplate_id, mode, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
          [agreementRowId, clientId, propertyId, owner.id, agreementId, agreementMode]
        );
      }
      approvalpending = approvalpending.map((p) => {
        const pid = p.propertyId || p.propertyid;
        const cid = p.clientId || p.clientid;
        if (pid === propertyId && cid === clientId && p.status === 'pending') {
          return { ...p, agreementid: agreementRowId, agreementId: agreementRowId, updatedAt: now };
        }
        return p;
      });
    } else {
      const duplicated = approvalpending.some((p) => {
        const pid = p.propertyId || p.propertyid;
        const cid = p.clientId || p.clientid;
        return pid === propertyId && cid === clientId && p.status === 'pending';
      });
      if (duplicated) return { ok: false, reason: 'DUPLICATE_PENDING' };
      agreementRowId = randomUUID();
      await pool.query(
        `INSERT INTO agreement (id, client_id, property_id, owner_id, agreementtemplate_id, mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
        [agreementRowId, clientId, propertyId, owner.id, agreementId, agreementMode]
      );
      approvalpending.push({
        propertyId,
        clientId,
        propertyid: propertyId,
        clientid: clientId,
        agreementid: agreementRowId,
        agreementId: agreementRowId,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      });
    }
  } else {
    if (isEdit) {
      approvalpending = approvalpending.map((p) => {
        const pid = p.propertyId || p.propertyid;
        const cid = p.clientId || p.clientid;
        if (pid === propertyId && cid === clientId && p.status === 'pending') {
          return { ...p, updatedAt: now };
        }
        return p;
      });
    } else {
      const duplicated = approvalpending.some((p) => {
        const pid = p.propertyId || p.propertyid;
        const cid = p.clientId || p.clientid;
        return pid === propertyId && cid === clientId && p.status === 'pending';
      });
      if (duplicated) return { ok: false, reason: 'DUPLICATE_PENDING' };
      approvalpending.push({
        propertyId,
        clientId,
        propertyid: propertyId,
        clientid: clientId,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      });
    }
  }

  await pool.query('UPDATE ownerdetail SET approvalpending = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(approvalpending),
    owner.id
  ]);
  return { ok: true };
}

/**
 * Delete (unlink) owner from property: set propertydetail.owner_id = null, remove from owner_property if present.
 * Does not delete ownerdetail row.
 */
async function deleteOwnerFromProperty(clientId, propertyId) {
  if (!clientId || !propertyId) return { ok: false, reason: 'MISSING_PARAMS' };
  const [rows] = await pool.query(
    'SELECT id, owner_id FROM propertydetail WHERE client_id = ? AND id = ? LIMIT 1',
    [clientId, propertyId]
  );
  if (!rows || !rows[0]) return { ok: false, reason: 'PROPERTY_NOT_FOUND' };
  const ownerId = rows[0].owner_id;
  if (!ownerId) return { ok: false, reason: 'PROPERTY_HAS_NO_OWNER' };

  await pool.query('UPDATE propertydetail SET owner_id = NULL, updated_at = NOW() WHERE id = ?', [propertyId]);
  try {
    await pool.query('DELETE FROM owner_property WHERE owner_id = ? AND property_id = ?', [ownerId, propertyId]);
  } catch (_) {
    // owner_property may not exist
  }
  return { ok: true };
}

/**
 * Remove owner–client mapping: DELETE FROM owner_client; clear ownerdetail.client_id so list no longer includes this owner.
 * Use when owner has no properties under this client; after this they no longer appear in this client's list.
 */
async function removeOwnerMapping(clientId, ownerId) {
  if (!clientId || !ownerId) return { ok: false, reason: 'MISSING_PARAMS' };
  try {
    await pool.query('DELETE FROM owner_client WHERE client_id = ? AND owner_id = ?', [clientId, ownerId]);
    try {
      await pool.query('UPDATE ownerdetail SET client_id = NULL, updated_at = NOW() WHERE id = ? AND client_id = ?', [ownerId, clientId]);
    } catch (_) {
      // client_id column may not exist on ownerdetail
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'DB_ERROR' };
  }
}

module.exports = {
  getOwnerList,
  getOwnerFilters,
  searchOwnerByEmail,
  getPropertyById,
  getAgreementTemplates,
  getPropertiesWithoutOwner,
  saveOwnerInvitation,
  deleteOwnerFromProperty,
  removeOwnerMapping
};
