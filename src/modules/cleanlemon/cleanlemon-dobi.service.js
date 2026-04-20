/**
 * Cleanlemons — Dobi laundry (`cln_dobi_*`).
 */
const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const clnSvc = require('./cleanlemon.service');
const clnDc = require('./cleanlemon-cln-domain-contacts');

function isNoSuchTable(err) {
  const c = String(err?.code || '');
  const msg = String(err?.message || err?.sqlMessage || '');
  return c === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist") || msg.includes('Unknown table');
}

async function assertTable() {
  if (!(await clnDc.databaseHasTable(pool, 'cln_dobi_lot'))) {
    const e = new Error('MIGRATION_REQUIRED');
    e.code = 'MIGRATION_REQUIRED';
    throw e;
  }
}

async function assertStaffOperator(email, operatorId) {
  await clnSvc.assertClnOperatorStaffEmail(operatorId, email);
}

async function ensureConfigRow(operatorId) {
  const oid = String(operatorId || '').trim();
  await pool.query(
    `INSERT IGNORE INTO cln_dobi_operator_config (operator_id, handoff_wash_to_dry_warning_minutes)
     VALUES (?, 15)`,
    [oid]
  );
}

async function ensureDefaultItemTypes(operatorId) {
  const oid = String(operatorId || '').trim();
  const [[cnt]] = await pool.query(
    'SELECT COUNT(*) AS c FROM cln_dobi_item_type WHERE operator_id = ? AND active = 1',
    [oid]
  );
  if (Number(cnt?.c) > 0) return;
  const defaults = [
    ['Bedsheet', 10],
    ['Towel', 20],
    ['Bathmat', 30],
    ['Pillow case', 40],
    ['Curtain', 50],
    ['Linens', 60],
  ];
  for (const [label, sort] of defaults) {
    const id = randomUUID();
    try {
      await pool.query(
        `INSERT INTO cln_dobi_item_type (id, operator_id, label, sort_order, active, wash_batch_pcs, wash_round_minutes)
         VALUES (?,?,?,?,1,40,45)`,
        [id, oid, label, sort]
      );
    } catch (e) {
      const msg = String(e?.message || e?.sqlMessage || '');
      if (msg.includes('wash_batch_pcs') || msg.includes('wash_round_minutes') || msg.includes('Unknown column')) {
        await pool.query(
          `INSERT INTO cln_dobi_item_type (id, operator_id, label, sort_order, active) VALUES (?,?,?,?,1)`,
          [id, oid, label, sort]
        );
      } else {
        throw e;
      }
    }
  }
}

/** Build map itemTypeId -> wash_batch_pcs (min 1). Unknown types default to 40. */
async function buildWashBatchCapsMap(operatorId) {
  const oid = String(operatorId || '').trim();
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, wash_batch_pcs FROM cln_dobi_item_type WHERE operator_id = ?`,
      [oid]
    );
  } catch (e) {
    const msg = String(e?.message || e?.sqlMessage || '');
    if (msg.includes('wash_batch_pcs') || msg.includes('Unknown column')) {
      return new Map();
    }
    throw e;
  }
  const m = new Map();
  for (const r of rows || []) {
    m.set(String(r.id), Math.max(1, Number(r.wash_batch_pcs) || 40));
  }
  return m;
}

/**
 * One wash load = one item type only (no mixing bedsheets + towels). Each line is split by that type's wash_batch_pcs.
 */
function packLinesIntoLotsByItemType(lines, capByItemTypeId) {
  const getCap = (itemTypeId) => {
    const v = capByItemTypeId.get(String(itemTypeId));
    return Math.max(1, Number(v) || 40);
  };
  const lots = [];
  const queue = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      teamName: String(l.teamName != null ? l.teamName : l.team_name || '').trim() || 'Unassigned',
      itemTypeId: String(l.itemTypeId != null ? l.itemTypeId : l.item_type_id || '').trim(),
      qty: Math.max(0, Number(l.qty) || 0),
    }))
    .filter((l) => l.qty > 0 && l.itemTypeId);

  for (const row of queue) {
    let remaining = row.qty;
    const cap = getCap(row.itemTypeId);
    while (remaining > 0) {
      const take = Math.min(remaining, cap);
      lots.push({
        pcsTotal: take,
        items: [{ itemTypeId: row.itemTypeId, teamName: row.teamName, qty: take }],
      });
      remaining -= take;
    }
  }
  return lots.map((lot) => ({
    pcsTotal: lot.pcsTotal,
    items: lot.items.map((i) => ({
      itemTypeId: i.itemTypeId,
      teamName: i.teamName,
      qty: i.qty,
    })),
  }));
}

async function getConfig(operatorId) {
  await assertTable();
  await ensureConfigRow(operatorId);
  const oid = String(operatorId || '').trim();
  let row;
  try {
    const [rows] = await pool.query(
      `SELECT operator_id, handoff_wash_to_dry_warning_minutes AS handoffWashToDryWarningMinutes,
              linen_qr_style AS linenQrStyle
       FROM cln_dobi_operator_config WHERE operator_id = ?`,
      [oid]
    );
    row = rows && rows[0];
  } catch (e) {
    const msg = String(e?.message || e?.sqlMessage || '');
    if (msg.includes('linen_qr_style') || msg.includes('Unknown column')) {
      const [rows] = await pool.query(
        `SELECT operator_id, handoff_wash_to_dry_warning_minutes AS handoffWashToDryWarningMinutes
         FROM cln_dobi_operator_config WHERE operator_id = ?`,
        [oid]
      );
      row = rows && rows[0];
      if (row) row.linenQrStyle = 'rotate_1min';
    } else {
      throw e;
    }
  }
  const styleRaw = row && row.linenQrStyle != null ? String(row.linenQrStyle).toLowerCase() : '';
  const linenQrStyle = styleRaw === 'permanent' ? 'permanent' : 'rotate_1min';
  return {
    operatorId: oid,
    handoffWashToDryWarningMinutes: row ? Number(row.handoffWashToDryWarningMinutes) || 15 : 15,
    linenQrStyle,
  };
}

async function putConfig(operatorId, email, patch) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  await ensureConfigRow(operatorId);
  const oid = String(operatorId || '').trim();
  const mins = patch?.handoffWashToDryWarningMinutes;
  if (mins != null && Number.isFinite(Number(mins))) {
    await pool.query(
      'UPDATE cln_dobi_operator_config SET handoff_wash_to_dry_warning_minutes = ? WHERE operator_id = ?',
      [Math.max(0, Math.min(24 * 60, Number(mins))), oid]
    );
  }
  if (patch?.linenQrStyle != null) {
    const s = String(patch.linenQrStyle).toLowerCase();
    const v = s === 'permanent' ? 'permanent' : 'rotate_1min';
    try {
      await pool.query('UPDATE cln_dobi_operator_config SET linen_qr_style = ? WHERE operator_id = ?', [v, oid]);
    } catch (e) {
      const msg = String(e?.message || e?.sqlMessage || '');
      if (msg.includes('linen_qr_style') || msg.includes('Unknown column')) {
        const err = new Error('MIGRATION_REQUIRED');
        err.code = 'MIGRATION_REQUIRED';
        throw err;
      }
      throw e;
    }
  }
  return getConfig(oid);
}

/** TTL for pending linen QR token from operator Dobi setting. */
function linenQrTtlMsForStyle(linenQrStyle) {
  return String(linenQrStyle || '').toLowerCase() === 'permanent' ? 24 * 60 * 60 * 1000 : 60 * 1000;
}

async function listItemTypes(operatorId) {
  await assertTable();
  const oid = String(operatorId || '').trim();
  await ensureDefaultItemTypes(oid);
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, label, sort_order AS sortOrder, active,
              wash_batch_pcs AS washBatchPcs, wash_round_minutes AS washRoundMinutes
       FROM cln_dobi_item_type
       WHERE operator_id = ? ORDER BY sort_order ASC, label ASC`,
      [oid]
    );
  } catch (e) {
    const msg = String(e?.message || e?.sqlMessage || '');
    if (msg.includes('wash_batch_pcs') || msg.includes('Unknown column')) {
      const [fallback] = await pool.query(
        `SELECT id, label, sort_order AS sortOrder, active FROM cln_dobi_item_type
         WHERE operator_id = ? ORDER BY sort_order ASC, label ASC`,
        [oid]
      );
      rows = fallback;
    } else {
      throw e;
    }
  }
  return (rows || []).map((r) => ({
    id: String(r.id),
    label: String(r.label),
    sortOrder: Number(r.sortOrder) || 0,
    active: !!r.active,
    washBatchPcs: r.washBatchPcs != null ? Math.max(1, Number(r.washBatchPcs) || 40) : 40,
    washRoundMinutes: r.washRoundMinutes != null ? Math.max(1, Number(r.washRoundMinutes) || 45) : 45,
  }));
}

async function replaceItemTypes(operatorId, email, items) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const list = Array.isArray(items) ? items : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM cln_dobi_item_type WHERE operator_id = ?', [oid]);
    let sort = 0;
    for (const it of list) {
      const label = String(it?.label || '').trim();
      if (!label) continue;
      const id = String(it?.id || '').trim() || randomUUID();
      const active = it?.active === false ? 0 : 1;
      const wb = Math.max(1, Number(it?.washBatchPcs ?? it?.wash_batch_pcs) || 40);
      const wr = Math.max(1, Number(it?.washRoundMinutes ?? it?.wash_round_minutes) || 45);
      const sortOrder = sort;
      sort += 1;
      try {
        await conn.query(
          `INSERT INTO cln_dobi_item_type (id, operator_id, label, sort_order, active, wash_batch_pcs, wash_round_minutes)
           VALUES (?,?,?,?,?,?,?)`,
          [id, oid, label, sortOrder, active, wb, wr]
        );
      } catch (e) {
        const msg = String(e?.message || e?.sqlMessage || '');
        if (msg.includes('wash_batch_pcs') || msg.includes('Unknown column')) {
          await conn.query(
            `INSERT INTO cln_dobi_item_type (id, operator_id, label, sort_order, active)
             VALUES (?,?,?,?,?)`,
            [id, oid, label, sortOrder, active]
          );
        } else {
          throw e;
        }
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listItemTypes(oid);
}

async function listMachines(operatorId) {
  await assertTable();
  const oid = String(operatorId || '').trim();
  const [rows] = await pool.query(
    `SELECT id, kind, name, capacity_pcs AS capacityPcs, round_minutes AS roundMinutes,
            sort_order AS sortOrder, active
     FROM cln_dobi_machine WHERE operator_id = ? ORDER BY kind, sort_order, name`,
    [oid]
  );
  return (rows || []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    name: String(r.name),
    capacityPcs: Number(r.capacityPcs) || 0,
    roundMinutes: Number(r.roundMinutes) || 0,
    sortOrder: Number(r.sortOrder) || 0,
    active: !!r.active,
  }));
}

async function replaceMachines(operatorId, email, machines) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const list = Array.isArray(machines) ? machines : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM cln_dobi_machine WHERE operator_id = ?', [oid]);
    let sort = 0;
    for (const m of list) {
      const kind = String(m?.kind || '').toLowerCase();
      if (!['washer', 'dryer', 'iron'].includes(kind)) continue;
      const name = String(m?.name || '').trim() || kind;
      const id = String(m?.id || '').trim() || randomUUID();
      const cap = Math.max(1, Number(m?.capacityPcs) || 40);
      const rm = Math.max(1, Number(m?.roundMinutes) || 45);
      const active = m?.active === false ? 0 : 1;
      await conn.query(
        `INSERT INTO cln_dobi_machine (id, operator_id, kind, name, capacity_pcs, round_minutes, sort_order, active)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, oid, kind, name, cap, rm, sort++, active]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listMachines(oid);
}

async function getOrCreateDay(operatorId, businessDate) {
  const oid = String(operatorId || '').trim();
  const bd = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    const e = new Error('INVALID_BUSINESS_DATE');
    e.code = 'INVALID_BUSINESS_DATE';
    throw e;
  }
  const [[existing]] = await pool.query(
    'SELECT id FROM cln_dobi_day WHERE operator_id = ? AND business_date = ? LIMIT 1',
    [oid, bd]
  );
  if (existing?.id) return String(existing.id);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO cln_dobi_day (id, operator_id, business_date, status) VALUES (?,?,?,'open')`,
    [id, oid, bd]
  );
  return id;
}

async function fetchLotItems(lotIds) {
  if (!lotIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT id, lot_id, item_type_id, team_name, qty FROM cln_dobi_lot_item
     WHERE lot_id IN (${lotIds.map(() => '?').join(',')})`,
    lotIds
  );
  const map = new Map();
  for (const r of rows || []) {
    const lid = String(r.lot_id);
    if (!map.has(lid)) map.set(lid, []);
    map.get(lid).push({
      id: String(r.id),
      itemTypeId: String(r.item_type_id),
      teamName: r.team_name != null ? String(r.team_name) : '',
      qty: Number(r.qty) || 0,
    });
  }
  return map;
}

function mapLotRow(r, items) {
  return {
    id: String(r.id),
    operatorId: String(r.operator_id),
    dayId: String(r.day_id),
    batchIndex: Number(r.batch_index) || 0,
    stage: String(r.stage),
    machineId: r.machine_id ? String(r.machine_id) : null,
    pcsTotal: Number(r.pcs_total) || 0,
    skipped: !!r.skipped,
    plannedEndAtUtc: r.planned_end_at_utc ? new Date(r.planned_end_at_utc).toISOString() : null,
    washStartedAtUtc: r.wash_started_at_utc ? new Date(r.wash_started_at_utc).toISOString() : null,
    washEndedAtUtc: r.wash_ended_at_utc ? new Date(r.wash_ended_at_utc).toISOString() : null,
    dryStartedAtUtc: r.dry_started_at_utc ? new Date(r.dry_started_at_utc).toISOString() : null,
    dryEndedAtUtc: r.dry_ended_at_utc ? new Date(r.dry_ended_at_utc).toISOString() : null,
    ironStartedAtUtc: r.iron_started_at_utc ? new Date(r.iron_started_at_utc).toISOString() : null,
    ironEndedAtUtc: r.iron_ended_at_utc ? new Date(r.iron_ended_at_utc).toISOString() : null,
    readyAtUtc: r.ready_at_utc ? new Date(r.ready_at_utc).toISOString() : null,
    returnedAtUtc: r.returned_at_utc ? new Date(r.returned_at_utc).toISOString() : null,
    items: items || [],
  };
}

async function getDayBundle(operatorId, businessDate, email) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const bd = String(businessDate || '').slice(0, 10);
  await ensureConfigRow(oid);
  await ensureDefaultItemTypes(oid);

  const [[dayRow]] = await pool.query(
    'SELECT id, business_date, status, created_at_utc FROM cln_dobi_day WHERE operator_id = ? AND business_date = ? LIMIT 1',
    [oid, bd]
  );
  const config = await getConfig(oid);
  const machines = await listMachines(oid);
  const itemTypes = await listItemTypes(oid);

  if (!dayRow) {
    return {
      ok: true,
      config,
      businessDate: bd,
      day: null,
      teams: [],
      lots: [],
      machines,
      itemTypes,
    };
  }

  const dayId = String(dayRow.id);
  const [teamRows] = await pool.query(
    'SELECT id, team_name, expected_pcs, remark_json FROM cln_dobi_day_team WHERE day_id = ? ORDER BY team_name',
    [dayId]
  );
  const teams = (teamRows || []).map((t) => ({
    id: String(t.id),
    teamName: String(t.team_name),
    expectedPcs: Number(t.expected_pcs) || 0,
    remarkJson: t.remark_json,
  }));

  const [lotRows] = await pool.query(
    `SELECT * FROM cln_dobi_lot WHERE operator_id = ? AND day_id = ? ORDER BY batch_index ASC, created_at_utc ASC`,
    [oid, dayId]
  );
  const lotIds = (lotRows || []).map((x) => String(x.id));
  const itemMap = await fetchLotItems(lotIds);
  const lots = (lotRows || []).map((r) => mapLotRow(r, itemMap.get(String(r.id)) || []));

  return {
    ok: true,
    config,
    businessDate: bd,
    day: {
      id: dayId,
      businessDate: String(dayRow.business_date).slice(0, 10),
      status: String(dayRow.status || 'open'),
      createdAtUtc: dayRow.created_at_utc ? new Date(dayRow.created_at_utc).toISOString() : null,
    },
    teams,
    lots,
    machines,
    itemTypes,
  };
}

async function previewSplit(operatorId, email, lines) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const capMap = await buildWashBatchCapsMap(operatorId);
  const lots = packLinesIntoLotsByItemType(lines, capMap);
  let maxCap = 40;
  for (const v of capMap.values()) {
    if (v > maxCap) maxCap = v;
  }
  return { ok: true, maxWasherCapacityPcs: maxCap, lots };
}

async function insertEvent(conn, { operatorId, lotId, machineId, eventType, email, payload }) {
  const id = randomUUID();
  const em = String(email || '').trim().toLowerCase();
  await conn.query(
    `INSERT INTO cln_dobi_event (id, operator_id, lot_id, machine_id, event_type, payload_json, created_by_email)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      String(operatorId),
      lotId || null,
      machineId || null,
      String(eventType),
      payload ? JSON.stringify(payload) : null,
      em,
    ]
  );
}

async function commitIntake(operatorId, email, businessDate, lines) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const capMap = await buildWashBatchCapsMap(operatorId);
  const packed = packLinesIntoLotsByItemType(lines, capMap);
  if (!packed.length) {
    const e = new Error('EMPTY_LINES');
    e.code = 'EMPTY_LINES';
    throw e;
  }

  const dayId = await getOrCreateDay(oid, businessDate);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[busy]] = await conn.query(
      `SELECT COUNT(*) AS c FROM cln_dobi_lot WHERE day_id = ? AND stage <> 'pending_wash'`,
      [dayId]
    );
    if (Number(busy?.c) > 0) {
      const e = new Error('INTAKE_LOCKED');
      e.code = 'INTAKE_LOCKED';
      throw e;
    }
    await conn.query(
      `DELETE li FROM cln_dobi_lot_item li
       INNER JOIN cln_dobi_lot l ON l.id = li.lot_id
       WHERE l.day_id = ? AND li.operator_id = ?`,
      [dayId, oid]
    );
    await conn.query('DELETE FROM cln_dobi_lot WHERE day_id = ?', [dayId]);

    let idx = 0;
    for (const lot of packed) {
      const lotId = randomUUID();
      await conn.query(
        `INSERT INTO cln_dobi_lot (
           id, operator_id, day_id, batch_index, stage, machine_id, pcs_total, skipped,
           created_at_utc, updated_at_utc
         ) VALUES (?,?,?,?, 'pending_wash', NULL, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [lotId, oid, dayId, idx++, lot.pcsTotal]
      );
      for (const it of lot.items) {
        const iid = randomUUID();
        await conn.query(
          `INSERT INTO cln_dobi_lot_item (id, operator_id, lot_id, item_type_id, team_name, qty)
           VALUES (?,?,?,?,?,?)`,
          [iid, oid, lotId, it.itemTypeId, it.teamName, it.qty]
        );
      }
      await insertEvent(conn, {
        operatorId: oid,
        lotId,
        machineId: null,
        eventType: 'intake_lot_created',
        email,
        payload: { batchIndex: idx - 1, pcsTotal: lot.pcsTotal },
      });
    }
    await insertEvent(conn, {
      operatorId: oid,
      lotId: null,
      machineId: null,
      eventType: 'intake_committed',
      email,
      payload: { businessDate: String(businessDate).slice(0, 10), lotCount: packed.length },
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return getDayBundle(oid, businessDate, email);
}

/**
 * Map employee linens QR totals (bedsheet, towel, …) to dobi item types by label.
 */
async function linenTotalsToDobiLines(operatorId, teamName, totals) {
  const t = totals && typeof totals === 'object' ? totals : {};
  const bedsheet = Math.max(0, Number(t.bedsheet) || 0);
  const pillowCase = Math.max(0, Number(t.pillowCase ?? t.pillow_case) || 0);
  const bedLinens = Math.max(0, Number(t.bedLinens ?? t.bed_linens) || 0);
  const bathmat = Math.max(0, Number(t.bathmat) || 0);
  const towel = Math.max(0, Number(t.towel) || 0);
  const types = await listItemTypes(operatorId);
  const activeTypes = types.filter((x) => x.active !== false);

  const findMatch = (pred) => {
    for (const typ of activeTypes) {
      const l = String(typ.label).toLowerCase();
      if (pred(l)) return String(typ.id);
    }
    return null;
  };

  const mapSpec = [
    ['bedsheet', bedsheet, (l) => l.includes('bedsheet')],
    ['pillowCase', pillowCase, (l) => l.includes('pillow')],
    ['bedLinens', bedLinens, (l) => l.includes('bed linen') || l === 'linens'],
    ['bathmat', bathmat, (l) => l.includes('bathmat') || l.includes('bath mat')],
    ['towel', towel, (l) => l.includes('towel')],
  ];

  const team = String(teamName || '').trim() || 'Unassigned';
  const lines = [];
  const missing = [];
  for (const [key, qty, pred] of mapSpec) {
    if (!qty) continue;
    const id = findMatch(pred);
    if (!id) missing.push(key);
    else lines.push({ teamName: team, itemTypeId: id, qty });
  }
  if (missing.length) {
    const e = new Error('NO_LINEN_ITEM_TYPE_MATCH');
    e.code = 'NO_LINEN_ITEM_TYPE_MATCH';
    e.missingKeys = missing;
    throw e;
  }
  return lines;
}

/**
 * Append pending-wash lots from a linen QR payload (after staff approves scan).
 * Skips DB write when all quantities are zero.
 */
async function appendIntakeFromLinenQrPayload(operatorId, email, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const bd = String(p.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    const e = new Error('INVALID_BUSINESS_DATE');
    e.code = 'INVALID_BUSINESS_DATE';
    throw e;
  }
  const team = String(p.team || 'Unassigned').trim() || 'Unassigned';

  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  const fromPayloadLines = rawLines
    .map((l) => ({
      itemTypeId: String(l.itemTypeId != null ? l.itemTypeId : l.item_type_id || '').trim(),
      qty: Math.max(0, Number(l.qty) || 0),
    }))
    .filter((l) => l.itemTypeId && l.qty > 0);

  if (fromPayloadLines.length > 0) {
    const types = await listItemTypes(operatorId);
    const allowed = new Set(types.map((t) => String(t.id)));
    for (const l of fromPayloadLines) {
      if (!allowed.has(l.itemTypeId)) {
        const e = new Error('INVALID_ITEM_TYPE');
        e.code = 'INVALID_ITEM_TYPE';
        throw e;
      }
    }
    const lines = fromPayloadLines.map((l) => ({
      teamName: team,
      itemTypeId: l.itemTypeId,
      qty: l.qty,
    }));
    return appendIntakeLots(operatorId, email, bd, lines, { source: 'linen_qr' });
  }

  const totals = {
    bedsheet: Math.max(0, Number(p.totals?.bedsheet) || 0),
    pillowCase: Math.max(0, Number(p.totals?.pillowCase ?? p.totals?.pillow_case) || 0),
    bedLinens: Math.max(0, Number(p.totals?.bedLinens ?? p.totals?.bed_linens) || 0),
    bathmat: Math.max(0, Number(p.totals?.bathmat) || 0),
    towel: Math.max(0, Number(p.totals?.towel) || 0),
  };
  const sum = totals.bedsheet + totals.pillowCase + totals.bedLinens + totals.bathmat + totals.towel;
  if (sum <= 0) return null;

  const lines = await linenTotalsToDobiLines(operatorId, team, totals);
  if (!lines.length) return null;
  return appendIntakeLots(operatorId, email, bd, lines, { source: 'linen_qr' });
}

/**
 * Append new pending_wash lot(s) without replacing the day (unlike commitIntake).
 */
async function appendIntakeLots(operatorId, email, businessDate, lines, meta = {}) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const bd = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    const e = new Error('INVALID_BUSINESS_DATE');
    e.code = 'INVALID_BUSINESS_DATE';
    throw e;
  }
  const cleanLines = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      teamName: String(l.teamName != null ? l.teamName : l.team_name || '').trim() || 'Unassigned',
      itemTypeId: String(l.itemTypeId != null ? l.itemTypeId : l.item_type_id || '').trim(),
      qty: Math.max(0, Number(l.qty) || 0),
    }))
    .filter((l) => l.qty > 0 && l.itemTypeId);

  const capMap = await buildWashBatchCapsMap(oid);
  const packed = packLinesIntoLotsByItemType(cleanLines, capMap);
  if (!packed.length) {
    const e = new Error('EMPTY_LINES');
    e.code = 'EMPTY_LINES';
    throw e;
  }

  const ts = String(meta.targetStage || 'pending_wash').trim().toLowerCase();
  if (ts !== 'pending_wash' && ts !== 'ready') {
    const e = new Error('INVALID_TARGET_STAGE');
    e.code = 'INVALID_TARGET_STAGE';
    throw e;
  }
  const addToReady = ts === 'ready';

  const dayId = await getOrCreateDay(oid, bd);
  const [[mxRow]] = await pool.query(
    `SELECT COALESCE(MAX(batch_index), -1) AS m FROM cln_dobi_lot WHERE day_id = ? AND operator_id = ?`,
    [dayId, oid]
  );
  let nextBatch = Number(mxRow?.m);
  if (!Number.isFinite(nextBatch)) nextBatch = -1;
  nextBatch += 1;

  const conn = await pool.getConnection();
  const source = String(meta.source || 'manual_append');
  try {
    await conn.beginTransaction();
    let idx = nextBatch;
    for (const lot of packed) {
      const lotId = randomUUID();
      const batchIndex = idx++;
      if (addToReady) {
        await conn.query(
          `INSERT INTO cln_dobi_lot (
             id, operator_id, day_id, batch_index, stage, machine_id, pcs_total, skipped,
             iron_ended_at_utc, ready_at_utc,
             created_at_utc, updated_at_utc
           ) VALUES (?,?,?,?, 'ready', NULL, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [lotId, oid, dayId, batchIndex, lot.pcsTotal]
        );
      } else {
        await conn.query(
          `INSERT INTO cln_dobi_lot (
             id, operator_id, day_id, batch_index, stage, machine_id, pcs_total, skipped,
             created_at_utc, updated_at_utc
           ) VALUES (?,?,?,?, 'pending_wash', NULL, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [lotId, oid, dayId, batchIndex, lot.pcsTotal]
        );
      }
      for (const it of lot.items) {
        const iid = randomUUID();
        await conn.query(
          `INSERT INTO cln_dobi_lot_item (id, operator_id, lot_id, item_type_id, team_name, qty)
           VALUES (?,?,?,?,?,?)`,
          [iid, oid, lotId, it.itemTypeId, it.teamName, it.qty]
        );
      }
      await insertEvent(conn, {
        operatorId: oid,
        lotId,
        machineId: null,
        eventType: 'intake_lot_created',
        email,
        payload: { batchIndex, pcsTotal: lot.pcsTotal, source, targetStage: addToReady ? 'ready' : 'pending_wash' },
      });
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return getDayBundle(oid, bd, email);
}

async function loadLot(operatorId, lotId) {
  const oid = String(operatorId || '').trim();
  const lid = String(lotId || '').trim();
  const [[r]] = await pool.query(
    'SELECT * FROM cln_dobi_lot WHERE id = ? AND operator_id = ? LIMIT 1',
    [lid, oid]
  );
  return r || null;
}

async function getBusinessDateForLot(operatorId, lotId) {
  const [[r]] = await pool.query(
    `SELECT d.business_date FROM cln_dobi_lot l
     JOIN cln_dobi_day d ON d.id = l.day_id
     WHERE l.id = ? AND l.operator_id = ? LIMIT 1`,
    [lotId, operatorId]
  );
  return r?.business_date ? String(r.business_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
}

async function lotAction(operatorId, email, body) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const lotId = String(body?.lotId || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();
  const machineId = body?.machineId ? String(body.machineId).trim() : null;
  const handoffRemark = body?.handoffRemark != null ? String(body.handoffRemark).trim() : '';

  const lot = await loadLot(oid, lotId);
  if (!lot) {
    const e = new Error('LOT_NOT_FOUND');
    e.code = 'LOT_NOT_FOUND';
    throw e;
  }

  const cfg = await getConfig(oid);
  const warnMins = cfg.handoffWashToDryWarningMinutes || 15;
  const now = new Date();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const refresh = async () => {
      const [[row]] = await conn.query('SELECT * FROM cln_dobi_lot WHERE id = ? LIMIT 1', [lotId]);
      return row;
    };

    const row = lot;
    const ev = (type, payload) =>
      insertEvent(conn, { operatorId: oid, lotId, machineId: machineId || null, eventType: type, email, payload });

    if (action === 'start_wash') {
      if (String(row.stage) !== 'pending_wash') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      if (!machineId) {
        const e = new Error('MACHINE_REQUIRED');
        e.code = 'MACHINE_REQUIRED';
        throw e;
      }
      const [[m]] = await conn.query(
        'SELECT id, kind, round_minutes, capacity_pcs FROM cln_dobi_machine WHERE id = ? AND operator_id = ? AND active = 1',
        [machineId, oid]
      );
      if (!m || String(m.kind) !== 'washer') {
        const e = new Error('INVALID_MACHINE');
        e.code = 'INVALID_MACHINE';
        throw e;
      }
      let rm = Math.max(1, Number(m.round_minutes) || 45);
      const [lotItems] = await conn.query(
        'SELECT item_type_id FROM cln_dobi_lot_item WHERE lot_id = ? AND operator_id = ? LIMIT 1',
        [lotId, oid]
      );
      const tid = lotItems?.[0]?.item_type_id ? String(lotItems[0].item_type_id) : '';
      if (tid) {
        try {
          const [[trow]] = await conn.query(
            'SELECT wash_round_minutes FROM cln_dobi_item_type WHERE id = ? AND operator_id = ? LIMIT 1',
            [tid, oid]
          );
          if (trow && trow.wash_round_minutes != null) {
            rm = Math.max(1, Number(trow.wash_round_minutes) || rm);
          }
        } catch (e) {
          const msg = String(e?.message || e?.sqlMessage || '');
          if (!msg.includes('wash_round_minutes') && !msg.includes('Unknown column')) throw e;
        }
      }
      const planned = new Date(now.getTime() + rm * 60 * 1000);
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'washing', machine_id = ?, wash_started_at_utc = UTC_TIMESTAMP(3),
            planned_end_at_utc = ?, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [machineId, planned, lotId]
      );
      await ev('start_wash', { plannedEndAtUtc: planned.toISOString() });
    } else if (action === 'finish_wash') {
      if (String(row.stage) !== 'washing') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'pending_dry', wash_ended_at_utc = UTC_TIMESTAMP(3),
            machine_id = NULL, planned_end_at_utc = NULL, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [lotId]
      );
      await ev('finish_wash', {});
    } else if (action === 'start_dry') {
      if (String(row.stage) !== 'pending_dry') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      const ended = row.wash_ended_at_utc ? new Date(row.wash_ended_at_utc) : null;
      if (ended) {
        const gapMin = (now - ended) / 60000;
        if (gapMin > warnMins) {
          if (!handoffRemark) {
            const e = new Error('HANDOFF_REMARK_REQUIRED');
            e.code = 'HANDOFF_REMARK_REQUIRED';
            e.gapMinutes = gapMin;
            throw e;
          }
        }
      }
      if (!machineId) {
        const e = new Error('MACHINE_REQUIRED');
        e.code = 'MACHINE_REQUIRED';
        throw e;
      }
      const [[m]] = await conn.query(
        'SELECT id, kind, round_minutes FROM cln_dobi_machine WHERE id = ? AND operator_id = ? AND active = 1',
        [machineId, oid]
      );
      if (!m || String(m.kind) !== 'dryer') {
        const e = new Error('INVALID_MACHINE');
        e.code = 'INVALID_MACHINE';
        throw e;
      }
      const rm = Math.max(1, Number(m.round_minutes) || 45);
      const planned = new Date(now.getTime() + rm * 60 * 1000);
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'drying', machine_id = ?, dry_started_at_utc = UTC_TIMESTAMP(3),
            planned_end_at_utc = ?, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [machineId, planned, lotId]
      );
      await ev('start_dry', { handoffRemark: handoffRemark || undefined, plannedEndAtUtc: planned.toISOString() });
    } else if (action === 'finish_dry') {
      if (String(row.stage) !== 'drying') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'pending_iron', dry_ended_at_utc = UTC_TIMESTAMP(3),
            machine_id = NULL, planned_end_at_utc = NULL, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [lotId]
      );
      await ev('finish_dry', {});
    } else if (action === 'start_iron') {
      if (String(row.stage) !== 'pending_iron') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      let mid = machineId;
      if (mid) {
        const [[m]] = await conn.query(
          'SELECT kind FROM cln_dobi_machine WHERE id = ? AND operator_id = ? AND active = 1',
          [mid, oid]
        );
        if (!m || String(m.kind) !== 'iron') {
          const e = new Error('INVALID_MACHINE');
          e.code = 'INVALID_MACHINE';
          throw e;
        }
      }
      const rm = 30;
      const planned = new Date(now.getTime() + rm * 60 * 1000);
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'ironing', machine_id = ?, iron_started_at_utc = UTC_TIMESTAMP(3),
            planned_end_at_utc = ?, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [mid, planned, lotId]
      );
      await ev('start_iron', { plannedEndAtUtc: planned.toISOString() });
    } else if (action === 'finish_iron') {
      if (String(row.stage) !== 'ironing') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      await conn.query(
        `UPDATE cln_dobi_lot SET stage = 'ready', iron_ended_at_utc = UTC_TIMESTAMP(3),
            ready_at_utc = UTC_TIMESTAMP(3), machine_id = NULL, planned_end_at_utc = NULL, updated_at_utc = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [lotId]
      );
      await ev('finish_iron', {});
    } else if (action === 'mark_returned') {
      if (String(row.stage) !== 'ready') {
        const e = new Error('INVALID_STAGE');
        e.code = 'INVALID_STAGE';
        throw e;
      }
      const rawTakeouts = body?.takeouts;
      const hasTakeoutsKey = rawTakeouts !== undefined && rawTakeouts !== null;
      if (hasTakeoutsKey) {
        if (!Array.isArray(rawTakeouts)) {
          const e = new Error('INVALID_TAKEOUTS');
          e.code = 'INVALID_TAKEOUTS';
          throw e;
        }
        const merged = new Map();
        for (const t of rawTakeouts) {
          const lineId = String(t?.itemLineId != null ? t.itemLineId : t?.item_line_id || '').trim();
          const q = Math.max(0, Math.floor(Number(t?.qty) || 0));
          if (!lineId || !q) continue;
          merged.set(lineId, (merged.get(lineId) || 0) + q);
        }
        if (merged.size === 0) {
          const e = new Error('TAKEOUT_REQUIRED');
          e.code = 'TAKEOUT_REQUIRED';
          throw e;
        }
        for (const [lineId, takeQty] of merged.entries()) {
          const [[line]] = await conn.query(
            'SELECT id, qty FROM cln_dobi_lot_item WHERE id = ? AND lot_id = ? AND operator_id = ? LIMIT 1',
            [lineId, lotId, oid]
          );
          if (!line) {
            const e = new Error('INVALID_ITEM_LINE');
            e.code = 'INVALID_ITEM_LINE';
            throw e;
          }
          const curr = Math.max(0, Math.floor(Number(line.qty) || 0));
          if (takeQty > curr) {
            const e = new Error('TAKEOUT_EXCEEDS');
            e.code = 'TAKEOUT_EXCEEDS';
            throw e;
          }
          const left = curr - takeQty;
          if (left <= 0) {
            await conn.query('DELETE FROM cln_dobi_lot_item WHERE id = ?', [lineId]);
          } else {
            await conn.query('UPDATE cln_dobi_lot_item SET qty = ? WHERE id = ?', [left, lineId]);
          }
        }
        const [[sumRow]] = await conn.query(
          'SELECT COALESCE(SUM(qty),0) AS s FROM cln_dobi_lot_item WHERE lot_id = ?',
          [lotId]
        );
        const newTotal = Math.max(0, Math.floor(Number(sumRow?.s) || 0));
        if (newTotal <= 0) {
          await conn.query(
            `UPDATE cln_dobi_lot SET pcs_total = 0, stage = 'returned', returned_at_utc = UTC_TIMESTAMP(3), updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
            [lotId]
          );
        } else {
          await conn.query(
            `UPDATE cln_dobi_lot SET pcs_total = ?, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
            [newTotal, lotId]
          );
        }
        await ev('mark_returned', { partial: true, remainingPcs: newTotal });
      } else {
        await conn.query(
          `UPDATE cln_dobi_lot SET stage = 'returned', returned_at_utc = UTC_TIMESTAMP(3), updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
          [lotId]
        );
        await ev('mark_returned', {});
      }
    } else if (action === 'skip') {
      await conn.query(
        `UPDATE cln_dobi_lot SET skipped = 1, updated_at_utc = UTC_TIMESTAMP(3) WHERE id = ?`,
        [lotId]
      );
      await ev('skip', { note: body?.remark || '' });
    } else {
      const e = new Error('UNKNOWN_ACTION');
      e.code = 'UNKNOWN_ACTION';
      throw e;
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const bd = String(body?.businessDate || '').slice(0, 10);
  const dateStr = bd || (await getBusinessDateForLot(oid, lotId));
  return getDayBundle(oid, dateStr, email);
}

async function report(operatorId, email, fromDate, toDate) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const f = String(fromDate || '').slice(0, 10);
  const t = String(toDate || '').slice(0, 10);
  const [lots] = await pool.query(
    `SELECT l.* FROM cln_dobi_lot l
     INNER JOIN cln_dobi_day d ON d.id = l.day_id
     WHERE l.operator_id = ? AND d.business_date >= ? AND d.business_date <= ?
     ORDER BY d.business_date DESC, l.batch_index ASC`,
    [oid, f, t]
  );
  const ids = (lots || []).map((x) => String(x.id));
  const itemMap = await fetchLotItems(ids);
  return {
    ok: true,
    fromDate: f,
    toDate: t,
    lots: (lots || []).map((r) => mapLotRow(r, itemMap.get(String(r.id)) || [])),
  };
}

async function listWorkflowEventsForDay(operatorId, email, businessDate) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const bd = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    const e = new Error('INVALID_BUSINESS_DATE');
    e.code = 'INVALID_BUSINESS_DATE';
    throw e;
  }
  const [[dayRow]] = await pool.query(
    'SELECT id FROM cln_dobi_day WHERE operator_id = ? AND business_date = ? LIMIT 1',
    [oid, bd]
  );
  if (!dayRow?.id) {
    return { ok: true, businessDate: bd, events: [] };
  }
  const dayId = String(dayRow.id);
  const [lotRows] = await pool.query('SELECT id FROM cln_dobi_lot WHERE day_id = ?', [dayId]);
  const lotIds = (lotRows || []).map((x) => String(x.id));
  if (!lotIds.length) {
    return { ok: true, businessDate: bd, events: [] };
  }
  const ph = lotIds.map(() => '?').join(',');
  const [evRows] = await pool.query(
    `SELECT e.id, e.event_type, e.created_by_email, e.created_at_utc, e.lot_id, e.machine_id, e.payload_json,
            m.name AS machine_name, m.kind AS machine_kind
     FROM cln_dobi_event e
     LEFT JOIN cln_dobi_machine m ON m.id = e.machine_id
     WHERE e.operator_id = ? AND e.lot_id IN (${ph})
     ORDER BY e.created_at_utc DESC
     LIMIT 500`,
    [oid, ...lotIds]
  );
  const emails = [
    ...new Set((evRows || []).map((r) => String(r.created_by_email || '').toLowerCase()).filter(Boolean)),
  ];
  let nameMap = new Map();
  if (emails.length) {
    const [nameRows] = await pool.query(
      `SELECT LOWER(TRIM(email)) AS em, full_name FROM cln_employeedetail WHERE LOWER(TRIM(email)) IN (${emails
        .map(() => '?')
        .join(',')})`,
      emails
    );
    for (const n of nameRows || []) {
      nameMap.set(String(n.em), String(n.full_name || '').trim());
    }
  }
  const events = (evRows || []).map((r) => {
    let payload = null;
    try {
      payload = r.payload_json ? JSON.parse(r.payload_json) : null;
    } catch (_) {
      payload = null;
    }
    const em = String(r.created_by_email || '').toLowerCase();
    return {
      id: String(r.id),
      eventType: String(r.event_type),
      createdByEmail: String(r.created_by_email || ''),
      staffName: nameMap.get(em) || null,
      createdAtUtc: r.created_at_utc ? new Date(r.created_at_utc).toISOString() : null,
      lotId: r.lot_id ? String(r.lot_id) : null,
      machineId: r.machine_id ? String(r.machine_id) : null,
      machineName: r.machine_name != null ? String(r.machine_name) : null,
      machineKind: r.machine_kind != null ? String(r.machine_kind) : null,
      payload,
    };
  });
  return { ok: true, businessDate: bd, events };
}

async function summary(operatorId, email, fromDate, toDate) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const oid = String(operatorId || '').trim();
  const f = String(fromDate || '').slice(0, 10);
  const t = String(toDate || '').slice(0, 10);
  const [[agg]] = await pool.query(
    `SELECT
       COUNT(*) AS lotCount,
       COALESCE(SUM(l.pcs_total),0) AS pcsTotal
     FROM cln_dobi_lot l
     INNER JOIN cln_dobi_day d ON d.id = l.day_id
     WHERE l.operator_id = ? AND d.business_date >= ? AND d.business_date <= ?`,
    [oid, f, t]
  );
  const [byStage] = await pool.query(
    `SELECT l.stage, COUNT(*) AS c, COALESCE(SUM(l.pcs_total),0) AS pcs
     FROM cln_dobi_lot l
     INNER JOIN cln_dobi_day d ON d.id = l.day_id
     WHERE l.operator_id = ? AND d.business_date >= ? AND d.business_date <= ?
     GROUP BY l.stage`,
    [oid, f, t]
  );
  return {
    ok: true,
    fromDate: f,
    toDate: t,
    lotCount: Number(agg?.lotCount) || 0,
    pcsTotal: Number(agg?.pcsTotal) || 0,
    byStage: (byStage || []).map((x) => ({
      stage: String(x.stage),
      count: Number(x.c) || 0,
      pcs: Number(x.pcs) || 0,
    })),
  };
}

/**
 * Dobi staff: report damaged linens (audit row in cln_dobi_event).
 */
async function submitDobiDamageLinen({ operatorId, email, businessDate, remark, lines, photoUrls }) {
  await assertTable();
  await assertStaffOperator(email, operatorId);
  const rem = String(remark || '').trim();
  if (!rem) {
    const e = new Error('MISSING_REMARK');
    e.code = 'MISSING_REMARK';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const bd = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    const e = new Error('INVALID_BUSINESS_DATE');
    e.code = 'INVALID_BUSINESS_DATE';
    throw e;
  }
  await getOrCreateDay(oid, bd);
  const cleanLines = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      itemTypeId: String(l?.itemTypeId || '').trim(),
      qty: Math.max(0, Number(l?.qty) || 0),
      teamName: String(l?.teamName != null ? l.teamName : '').trim() || 'Unassigned',
    }))
    .filter((l) => l.itemTypeId && l.qty > 0);
  const photos = Array.isArray(photoUrls) ? photoUrls.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 10) : [];
  const payload = {
    businessTimeZone: 'Asia/Kuala_Lumpur',
    businessDate: bd,
    remark: rem,
    lines: cleanLines,
    photoUrls: photos,
  };
  const id = randomUUID();
  const em = String(email || '').trim().toLowerCase();
  await pool.query(
    `INSERT INTO cln_dobi_event (id, operator_id, lot_id, event_type, payload_json, created_by_email)
     VALUES (?,?,NULL,'damage_linen',?,?)`,
    [id, oid, JSON.stringify(payload), em]
  );
  return { ok: true, id };
}

module.exports = {
  assertTable,
  getConfig,
  putConfig,
  linenQrTtlMsForStyle,
  listItemTypes,
  replaceItemTypes,
  listMachines,
  replaceMachines,
  getDayBundle,
  previewSplit,
  commitIntake,
  appendIntakeLots,
  appendIntakeFromLinenQrPayload,
  lotAction,
  report,
  summary,
  submitDobiDamageLinen,
  listWorkflowEventsForDay,
};
