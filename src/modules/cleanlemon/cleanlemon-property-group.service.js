/**
 * B2B client portal — property groups (per-property operator; mixed operators in one group), email invites, permissions.
 * Member permissions: property / booking / status × create, edit, delete.
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');

function fullPerm() {
  return {
    property: { create: true, edit: true, delete: true },
    booking: { create: true, edit: true, delete: true },
    status: { create: true, edit: true, delete: true },
  };
}

function emptyPerm() {
  return {
    property: { create: false, edit: false, delete: false },
    booking: { create: false, edit: false, delete: false },
    status: { create: false, edit: false, delete: false },
  };
}

function rowToPerm(r) {
  if (!r) return emptyPerm();
  const n = (x) => (Number(x) === 1 ? true : false);
  return {
    property: {
      create: n(r.perm_property_create ?? r.p_pc),
      edit: n(r.perm_property_edit ?? r.p_pe),
      delete: n(r.perm_property_delete ?? r.p_pd),
    },
    booking: {
      create: n(r.perm_booking_create ?? r.b_bc),
      edit: n(r.perm_booking_edit ?? r.b_be),
      delete: n(r.perm_booking_delete ?? r.b_bd),
    },
    status: {
      create: n(r.perm_status_create ?? r.s_sc),
      edit: n(r.perm_status_edit ?? r.s_se),
      delete: n(r.perm_status_delete ?? r.s_sd),
    },
  };
}

function mergePermTriples(a, b) {
  const out = emptyPerm();
  for (const k of ['property', 'booking', 'status']) {
    for (const op of ['create', 'edit', 'delete']) {
      out[k][op] = !!(a[k][op] || b[k][op]);
    }
  }
  return out;
}

/**
 * Parse invite / permission API body. Supports `perm: { property: { create, edit, delete }, ... }`
 * or legacy `canProperty` / `canBooking` / `canStatus` (maps each to all three ops in that domain).
 */
function parsePermFromRequestBody(b) {
  const src = b && typeof b === 'object' ? b : {};
  if (src.perm && typeof src.perm === 'object') {
    const p = src.perm;
    const tri = (o) => {
      const x = o && typeof o === 'object' ? o : {};
      return {
        create: !!x.create,
        edit: !!x.edit,
        delete: !!x.delete,
      };
    };
    return {
      property: tri(p.property),
      booking: tri(p.booking),
      status: tri(p.status),
    };
  }
  const legacyP = src.canProperty !== undefined ? !!src.canProperty : !!src.canDelete;
  const legacyBk = src.canBooking !== undefined ? !!src.canBooking : !!src.canCreate;
  const legacySt = src.canStatus !== undefined ? !!src.canStatus : !!src.canEdit;
  return {
    property: { create: legacyP, edit: legacyP, delete: legacyP },
    booking: { create: legacyBk, edit: legacyBk, delete: legacyBk },
    status: { create: legacySt, edit: legacySt, delete: legacySt },
  };
}

function permToSqlTuple(perm) {
  const p = perm || emptyPerm();
  return [
    p.property.create ? 1 : 0,
    p.property.edit ? 1 : 0,
    p.property.delete ? 1 : 0,
    p.booking.create ? 1 : 0,
    p.booking.edit ? 1 : 0,
    p.booking.delete ? 1 : 0,
    p.status.create ? 1 : 0,
    p.status.edit ? 1 : 0,
    p.status.delete ? 1 : 0,
  ];
}

async function propertyGroupTablesExist() {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property_group'`
    );
    return row && Number(row.n) > 0;
  } catch {
    return false;
  }
}

function normEmail(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

async function resolveLoginEmailForClientdetail(clientdetailId, loginEmail) {
  let em = normEmail(loginEmail);
  if (em) return em;
  const cid = String(clientdetailId || '').trim();
  if (!cid) return '';
  const [[d]] = await pool.query(
    'SELECT LOWER(TRIM(email)) AS e FROM cln_clientdetail WHERE id = ? LIMIT 1',
    [cid]
  );
  return d?.e ? String(d.e) : '';
}

/** Activate pending invites when email matches invite_email. */
async function activatePendingInvitesForClientPortal(clientdetailId, loginEmail) {
  if (!(await propertyGroupTablesExist())) return;
  const cid = String(clientdetailId || '').trim();
  if (!cid) return;
  const em = await resolveLoginEmailForClientdetail(cid, loginEmail);
  if (!em) return;
  await pool.query(
    `UPDATE cln_property_group_member
     SET grantee_clientdetail_id = ?,
         invite_status = 'active',
         accepted_at = COALESCE(accepted_at, NOW(3))
     WHERE invite_email = ?
       AND invite_status = 'pending'
       AND (grantee_clientdetail_id IS NULL OR grantee_clientdetail_id = ?)`,
    [cid, em, cid]
  );
}

/**
 * @returns {Promise<{
 *   access: 'none'|'owner'|'group_owner'|'member',
 *   groupId: string|null,
 *   perm: ReturnType<typeof fullPerm>
 * }>}
 */
async function getClientPropertyGroupAccess(clientdetailId, propertyId) {
  const out = {
    access: 'none',
    groupId: null,
    perm: emptyPerm(),
  };
  const cid = String(clientdetailId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!cid || !pid) return out;
  if (!(await propertyGroupTablesExist())) return out;

  const [[prop]] = await pool.query(
    'SELECT clientdetail_id, operator_id FROM cln_property WHERE id = ? LIMIT 1',
    [pid]
  );
  if (!prop) return out;
  if (String(prop.clientdetail_id || '').trim() === cid) {
    return {
      access: 'owner',
      groupId: null,
      perm: fullPerm(),
    };
  }

  const [[gOwn]] = await pool.query(
    `SELECT gpg.id AS gid
     FROM cln_property_group_property gpp
     INNER JOIN cln_property_group gpg ON gpg.id = gpp.group_id
     WHERE gpp.property_id = ? AND gpg.owner_clientdetail_id = ?
     LIMIT 1`,
    [pid, cid]
  );
  if (gOwn?.gid) {
    return {
      access: 'group_owner',
      groupId: String(gOwn.gid),
      perm: fullPerm(),
    };
  }

  const [memRows] = await pool.query(
    `SELECT gpg.id AS gid, m.perm_property_create, m.perm_property_edit, m.perm_property_delete,
            m.perm_booking_create, m.perm_booking_edit, m.perm_booking_delete,
            m.perm_status_create, m.perm_status_edit, m.perm_status_delete
     FROM cln_property_group_property gpp
     INNER JOIN cln_property_group gpg ON gpg.id = gpp.group_id
     INNER JOIN cln_property_group_member m ON m.group_id = gpg.id
     WHERE gpp.property_id = ?
       AND m.grantee_clientdetail_id = ?
       AND m.invite_status = 'active'`,
    [pid, cid]
  );
  const rows = Array.isArray(memRows) ? memRows : [];
  if (!rows.length) return out;
  let merged = emptyPerm();
  let gid = null;
  for (const r of rows) {
    merged = mergePermTriples(merged, rowToPerm(r));
    if (!gid) gid = String(r.gid);
  }
  return {
    access: 'member',
    groupId: gid,
    perm: merged,
  };
}

/**
 * @param {'property'|'booking'|'status'} domain
 * @param {'create'|'edit'|'delete'} op
 */
async function assertPropertyActionAllowed(clientdetailId, propertyId, domain, op) {
  const a = await getClientPropertyGroupAccess(clientdetailId, propertyId);
  if (a.access === 'none') {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  const slice = a.perm[domain];
  if (!slice || !slice[op]) {
    const e = new Error('GROUP_PERMISSION_DENIED');
    e.code = 'GROUP_PERMISSION_DENIED';
    throw e;
  }
  return a;
}

async function assertGroupPropertyInScope({ clientdetailId, groupId, propertyId, operatorId }) {
  const gid = String(groupId || '').trim();
  const pid = String(propertyId || '').trim();
  const oid = String(operatorId || '').trim();
  const cid = String(clientdetailId || '').trim();
  if (!gid || !pid || !oid || !cid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (!(await propertyGroupTablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  const [[row]] = await pool.query(
    `SELECT gpg.id AS gid, gpg.owner_clientdetail_id AS ownerCd
     FROM cln_property_group_property gpp
     INNER JOIN cln_property_group gpg ON gpg.id = gpp.group_id
     WHERE gpp.property_id = ? AND gpg.id = ?
     LIMIT 1`,
    [pid, gid]
  );
  if (!row) {
    const e = new Error('GROUP_PROPERTY_MISMATCH');
    e.code = 'GROUP_PROPERTY_MISMATCH';
    throw e;
  }
  const [[p2]] = await pool.query(
    'SELECT operator_id, clientdetail_id FROM cln_property WHERE id = ? LIMIT 1',
    [pid]
  );
  if (!p2) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  if (String(p2.operator_id || '').trim() !== oid) {
    const e = new Error('PROPERTY_OPERATOR_MISMATCH');
    e.code = 'PROPERTY_OPERATOR_MISMATCH';
    throw e;
  }
  const ownerCd = String(row.ownerCd || '').trim();
  const isGroupOwner = ownerCd === cid;
  const [[mem]] = await pool.query(
    `SELECT perm_property_create, perm_property_edit, perm_property_delete,
            perm_booking_create, perm_booking_edit, perm_booking_delete,
            perm_status_create, perm_status_edit, perm_status_delete
     FROM cln_property_group_member
     WHERE group_id = ? AND grantee_clientdetail_id = ? AND invite_status = 'active'
     LIMIT 1`,
    [gid, cid]
  );
  if (!isGroupOwner && !mem) {
    const e = new Error('GROUP_ACCESS_DENIED');
    e.code = 'GROUP_ACCESS_DENIED';
    throw e;
  }
  const perm = isGroupOwner ? fullPerm() : rowToPerm(mem);
  return {
    isGroupOwner,
    perm,
  };
}

async function listGroupsForClientPortal(clientdetailId, { operatorId, loginEmail } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  if (!(await propertyGroupTablesExist())) return [];
  await activatePendingInvitesForClientPortal(cid, loginEmail);
  const oid = String(operatorId || '').trim();
  const args = [cid, cid];
  let opFilter = '';
  if (oid) {
    opFilter = ` AND (
      gpg.operator_id <=> ?
      OR EXISTS (
        SELECT 1 FROM cln_property_group_property gpx
        INNER JOIN cln_property px ON px.id = gpx.property_id
        WHERE gpx.group_id = gpg.id AND NULLIF(TRIM(px.operator_id), '') IS NOT NULL AND px.operator_id = ?
      )
      OR NOT EXISTS (SELECT 1 FROM cln_property_group_property gpy WHERE gpy.group_id = gpg.id)
    )`;
    args.push(oid, oid);
  }
  const [rows2] = await pool.query(
    `SELECT gpg.id, gpg.name, gpg.operator_id AS operatorId, gpg.owner_clientdetail_id AS ownerClientdetailId,
            (SELECT COUNT(*) FROM cln_property_group_property x WHERE x.group_id = gpg.id) AS propertyCount
     FROM cln_property_group gpg
     LEFT JOIN cln_property_group_member m ON m.group_id = gpg.id AND m.grantee_clientdetail_id = ? AND m.invite_status = 'active'
     WHERE gpg.owner_clientdetail_id = ? OR m.id IS NOT NULL
     ${opFilter}
     ORDER BY gpg.updated_at DESC, gpg.created_at DESC`,
    args
  );
  return (rows2 || []).map((r) => ({
    id: String(r.id || ''),
    name: String(r.name || ''),
    operatorId: String(r.operatorId || ''),
    propertyCount: Number(r.propertyCount) || 0,
    isOwner: String(r.ownerClientdetailId || '').trim() === cid,
  }));
}

async function assertGroupOwner(groupId, ownerClientdetailId) {
  const [[g]] = await pool.query(
    'SELECT id FROM cln_property_group WHERE id = ? AND owner_clientdetail_id = ? LIMIT 1',
    [groupId, ownerClientdetailId]
  );
  if (!g) {
    const e = new Error('GROUP_NOT_FOUND_OR_FORBIDDEN');
    e.code = 'GROUP_NOT_FOUND_OR_FORBIDDEN';
    throw e;
  }
}

async function createPropertyGroup({ ownerClientdetailId, operatorId, name }) {
  if (!(await propertyGroupTablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  let oid = String(operatorId || '').trim();
  const cid = String(ownerClientdetailId || '').trim();
  const nm = String(name || '').trim().slice(0, 255) || 'Group';
  if (!cid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (oid) {
    const ct = await resolveClnOperatordetailTable();
    const [[opOk]] = await pool.query(`SELECT id FROM \`${ct}\` WHERE id = ? LIMIT 1`, [oid]);
    if (!opOk) {
      oid = '';
    } else {
      const [[link]] = await pool.query(
        'SELECT 1 AS ok FROM cln_client_operator WHERE operator_id = ? AND clientdetail_id = ? LIMIT 1',
        [oid, cid]
      );
      if (!link) {
        const e = new Error('CLIENTDETAIL_NOT_LINKED');
        e.code = 'CLIENTDETAIL_NOT_LINKED';
        throw e;
      }
    }
  }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO cln_property_group (id, owner_clientdetail_id, operator_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))`,
    [id, cid, oid || null, nm]
  );
  return { id, name: nm, operatorId: oid };
}

async function updatePropertyGroupName({ groupId, ownerClientdetailId, name }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const nm = String(name || '').trim().slice(0, 255);
  if (!nm) {
    const e = new Error('MISSING_NAME');
    e.code = 'MISSING_NAME';
    throw e;
  }
  await pool.query(
    'UPDATE cln_property_group SET name = ?, updated_at = NOW(3) WHERE id = ?',
    [nm, groupId]
  );
  return { ok: true };
}

async function deletePropertyGroup({ groupId, ownerClientdetailId }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  await pool.query('DELETE FROM cln_property_group WHERE id = ?', [groupId]);
  return { ok: true };
}

async function addPropertyToGroup({ groupId, ownerClientdetailId, propertyId }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const pid = String(propertyId || '').trim();
  if (!pid) {
    const e = new Error('MISSING_PROPERTY_ID');
    e.code = 'MISSING_PROPERTY_ID';
    throw e;
  }
  const [[g]] = await pool.query(
    'SELECT operator_id, owner_clientdetail_id FROM cln_property_group WHERE id = ? LIMIT 1',
    [groupId]
  );
  if (!g) {
    const e = new Error('GROUP_NOT_FOUND');
    e.code = 'GROUP_NOT_FOUND';
    throw e;
  }
  const [[p]] = await pool.query(
    'SELECT clientdetail_id, operator_id FROM cln_property WHERE id = ? LIMIT 1',
    [pid]
  );
  if (!p) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  if (String(p.clientdetail_id || '').trim() !== String(g.owner_clientdetail_id || '').trim()) {
    const e = new Error('PROPERTY_OWNER_MISMATCH');
    e.code = 'PROPERTY_OWNER_MISMATCH';
    throw e;
  }
  const [[other]] = await pool.query(
    'SELECT group_id FROM cln_property_group_property WHERE property_id = ? LIMIT 1',
    [pid]
  );
  if (other && String(other.group_id) !== String(groupId)) {
    const e = new Error('PROPERTY_ALREADY_IN_GROUP');
    e.code = 'PROPERTY_ALREADY_IN_GROUP';
    throw e;
  }
  await pool.query(
    `INSERT INTO cln_property_group_property (group_id, property_id, created_at)
     VALUES (?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE group_id = group_id`,
    [groupId, pid]
  );
  return { ok: true };
}

async function removePropertyFromGroup({ groupId, ownerClientdetailId, propertyId }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const pid = String(propertyId || '').trim();
  await pool.query('DELETE FROM cln_property_group_property WHERE group_id = ? AND property_id = ?', [
    groupId,
    pid,
  ]);
  return { ok: true };
}

async function inviteMemberByEmail({ groupId, ownerClientdetailId, inviteEmail, perm }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const em = normEmail(inviteEmail);
  if (!em || !em.includes('@')) {
    const e = new Error('INVALID_EMAIL');
    e.code = 'INVALID_EMAIL';
    throw e;
  }
  const [[own]] = await pool.query('SELECT LOWER(TRIM(email)) AS e FROM cln_clientdetail WHERE id = ? LIMIT 1', [
    ownerClientdetailId,
  ]);
  if (own?.e && String(own.e) === em) {
    const e = new Error('CANNOT_INVITE_SELF');
    e.code = 'CANNOT_INVITE_SELF';
    throw e;
  }
  const id = crypto.randomUUID();
  const t = permToSqlTuple(perm);
  try {
    await pool.query(
      `INSERT INTO cln_property_group_member
       (id, group_id, grantee_clientdetail_id, invite_email, invite_status,
        perm_property_create, perm_property_edit, perm_property_delete,
        perm_booking_create, perm_booking_edit, perm_booking_delete,
        perm_status_create, perm_status_edit, perm_status_delete,
        invited_at)
       VALUES (?, ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [id, groupId, em, ...t]
    );
  } catch (e) {
    if (String(e?.code) === 'ER_DUP_ENTRY') {
      const err = new Error('INVITE_DUPLICATE');
      err.code = 'INVITE_DUPLICATE';
      throw err;
    }
    throw e;
  }
  return { id, inviteEmail: em };
}

async function updateMemberPermissions({ groupId, ownerClientdetailId, memberId, perm }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const mid = String(memberId || '').trim();
  const t = permToSqlTuple(perm);
  await pool.query(
    `UPDATE cln_property_group_member SET
       perm_property_create = ?, perm_property_edit = ?, perm_property_delete = ?,
       perm_booking_create = ?, perm_booking_edit = ?, perm_booking_delete = ?,
       perm_status_create = ?, perm_status_edit = ?, perm_status_delete = ?
     WHERE id = ? AND group_id = ?`,
    [...t, mid, groupId]
  );
  return { ok: true };
}

async function kickMember({ groupId, ownerClientdetailId, memberId }) {
  await assertGroupOwner(groupId, ownerClientdetailId);
  const mid = String(memberId || '').trim();
  await pool.query(
    `UPDATE cln_property_group_member SET invite_status = 'revoked', revoked_at = NOW(3)
     WHERE id = ? AND group_id = ?`,
    [mid, groupId]
  );
  return { ok: true };
}

async function listGroupMembers({ groupId, clientdetailId, loginEmail }) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  if (!(await propertyGroupTablesExist())) return [];
  await activatePendingInvitesForClientPortal(cid, loginEmail);
  const [[g]] = await pool.query(
    'SELECT owner_clientdetail_id FROM cln_property_group WHERE id = ? LIMIT 1',
    [groupId]
  );
  if (!g) return [];
  const isOwner = String(g.owner_clientdetail_id || '').trim() === cid;
  const [[mem]] = await pool.query(
    `SELECT 1 AS ok FROM cln_property_group_member
     WHERE group_id = ? AND grantee_clientdetail_id = ? AND invite_status = 'active'
     LIMIT 1`,
    [groupId, cid]
  );
  if (!isOwner && !mem) {
    const e = new Error('GROUP_ACCESS_DENIED');
    e.code = 'GROUP_ACCESS_DENIED';
    throw e;
  }
  const [rows] = await pool.query(
    `SELECT m.id, m.invite_email AS inviteEmail, m.invite_status AS inviteStatus,
            m.perm_property_create, m.perm_property_edit, m.perm_property_delete,
            m.perm_booking_create, m.perm_booking_edit, m.perm_booking_delete,
            m.perm_status_create, m.perm_status_edit, m.perm_status_delete,
            m.grantee_clientdetail_id AS granteeClientdetailId
     FROM cln_property_group_member m
     WHERE m.group_id = ? AND m.invite_status <> 'revoked'
     ORDER BY m.invited_at ASC`,
    [groupId]
  );
  return (rows || []).map((r) => ({
    id: String(r.id || ''),
    inviteEmail: String(r.inviteEmail || ''),
    inviteStatus: String(r.inviteStatus || ''),
    perm: rowToPerm(r),
    granteeClientdetailId: r.granteeClientdetailId ? String(r.granteeClientdetailId) : null,
  }));
}

async function getGroupDetailForClient({ groupId, clientdetailId, loginEmail }) {
  const cid = String(clientdetailId || '').trim();
  const gid = String(groupId || '').trim();
  if (!cid || !gid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (!(await propertyGroupTablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  await activatePendingInvitesForClientPortal(cid, loginEmail);
  const [[g]] = await pool.query(
    'SELECT id, name, operator_id AS operatorId, owner_clientdetail_id AS ownerCd FROM cln_property_group WHERE id = ? LIMIT 1',
    [gid]
  );
  if (!g) {
    const e = new Error('GROUP_NOT_FOUND');
    e.code = 'GROUP_NOT_FOUND';
    throw e;
  }
  const isOwner = String(g.ownerCd || '').trim() === cid;
  const [[mem]] = await pool.query(
    `SELECT 1 AS ok FROM cln_property_group_member
     WHERE group_id = ? AND grantee_clientdetail_id = ? AND invite_status = 'active'
     LIMIT 1`,
    [gid, cid]
  );
  if (!isOwner && !mem) {
    const e = new Error('GROUP_ACCESS_DENIED');
    e.code = 'GROUP_ACCESS_DENIED';
    throw e;
  }
  const [prows] = await pool.query(
    `SELECT p.id, COALESCE(p.property_name, '') AS name, COALESCE(p.unit_name, '') AS unitNumber
     FROM cln_property_group_property gpp
     INNER JOIN cln_property p ON p.id = gpp.property_id
     WHERE gpp.group_id = ?`,
    [gid]
  );
  return {
    id: String(g.id),
    name: String(g.name || ''),
    operatorId: String(g.operatorId || ''),
    isOwner,
    properties: (prows || []).map((p) => ({
      id: String(p.id),
      name: String(p.name || ''),
      unitNumber: String(p.unitNumber || ''),
    })),
  };
}

module.exports = {
  propertyGroupTablesExist,
  activatePendingInvitesForClientPortal,
  getClientPropertyGroupAccess,
  assertPropertyActionAllowed,
  assertGroupPropertyInScope,
  parsePermFromRequestBody,
  listGroupsForClientPortal,
  createPropertyGroup,
  updatePropertyGroupName,
  deletePropertyGroup,
  addPropertyToGroup,
  removePropertyFromGroup,
  inviteMemberByEmail,
  updateMemberPermissions,
  kickMember,
  listGroupMembers,
  getGroupDetailForClient,
};
