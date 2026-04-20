/**
 * Cleanlemons — employee driver route orders (`cln_driver_trip`).
 */
const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const accessSvc = require('../access/access.service');
const clnDc = require('./cleanlemon-cln-domain-contacts');
const clnSvc = require('./cleanlemon.service');

const ACTIVE_STATUSES = new Set(['pending', 'driver_accepted', 'grab_booked']);

function isNoSuchTable(err) {
  const c = String(err?.code || '');
  const msg = String(err?.message || err?.sqlMessage || '');
  return c === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist") || msg.includes('Unknown table');
}

function normalizeScheduleOffset(raw) {
  const x = String(raw || '').trim().toLowerCase();
  if (x === '15') return '15';
  if (x === '30') return '30';
  return 'now';
}

function mapTripRow(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    operatorId: String(r.operator_id),
    requesterEmployeeId: String(r.requester_employee_id),
    requesterEmail: r.requester_email != null ? String(r.requester_email) : '',
    pickup: r.pickup_text != null ? String(r.pickup_text) : '',
    dropoff: r.dropoff_text != null ? String(r.dropoff_text) : '',
    scheduleOffset: r.schedule_offset != null ? String(r.schedule_offset) : 'now',
    orderTimeUtc: r.order_time_utc ? new Date(r.order_time_utc).toISOString() : null,
    businessTimeZone: r.business_time_zone != null ? String(r.business_time_zone) : 'Asia/Kuala_Lumpur',
    status: r.status != null ? String(r.status) : 'pending',
    fulfillmentType: r.fulfillment_type != null ? String(r.fulfillment_type) : 'none',
    acceptedDriverEmployeeId: r.accepted_driver_employee_id ? String(r.accepted_driver_employee_id) : null,
    acceptedAtUtc: r.accepted_at_utc ? new Date(r.accepted_at_utc).toISOString() : null,
    driverStartedAtUtc: r.driver_started_at_utc ? new Date(r.driver_started_at_utc).toISOString() : null,
    grabCarPlate: r.grab_car_plate != null ? String(r.grab_car_plate) : null,
    grabPhone: r.grab_phone != null ? String(r.grab_phone) : null,
    grabProofImageUrl: r.grab_proof_image_url != null ? String(r.grab_proof_image_url) : null,
    grabBookedByEmail: r.grab_booked_by_email != null ? String(r.grab_booked_by_email) : null,
    grabBookedAtUtc: r.grab_booked_at_utc ? new Date(r.grab_booked_at_utc).toISOString() : null,
    completedAtUtc: r.completed_at_utc ? new Date(r.completed_at_utc).toISOString() : null,
    createdAtUtc: r.created_at_utc ? new Date(r.created_at_utc).toISOString() : null,
    requesterFullName: r.requester_full_name != null ? String(r.requester_full_name) : null,
    requesterTeamName:
      r.requester_team_name != null && String(r.requester_team_name).trim() !== ''
        ? String(r.requester_team_name).trim()
        : null,
    acceptedDriverFullName: r.accepted_driver_full_name != null ? String(r.accepted_driver_full_name) : null,
    acceptedDriverPhone: r.accepted_driver_phone != null ? String(r.accepted_driver_phone) : null,
    acceptedDriverAvatarUrl: r.accepted_driver_avatar_url != null ? String(r.accepted_driver_avatar_url) : null,
    acceptedDriverCarPlate:
      r.accepted_driver_car_plate != null && String(r.accepted_driver_car_plate).trim() !== ''
        ? String(r.accepted_driver_car_plate).trim()
        : null,
    acceptedDriverCarFrontUrl:
      r.accepted_driver_car_front_url != null && String(r.accepted_driver_car_front_url).trim() !== ''
        ? String(r.accepted_driver_car_front_url).trim()
        : null,
    acceptedDriverCarBackUrl:
      r.accepted_driver_car_back_url != null && String(r.accepted_driver_car_back_url).trim() !== ''
        ? String(r.accepted_driver_car_back_url).trim()
        : null,
  };
}

/** Cached SELECT for trip rows; adds requester team from CRM; adds driver vehicle cols when migrated. */
let _tripSelectSqlCache = { key: '', sql: '' };
async function getTripSelectSql() {
  const hasCrm = await hasColumn('cln_employee_operator', 'crm_json');
  const hasDrvVeh = await hasColumn('cln_employeedetail', 'driver_car_plate');
  const hasStartedCol = await hasColumn('cln_driver_trip', 'driver_started_at_utc');
  const cacheKey = `${hasCrm}|${hasDrvVeh}|${hasStartedCol}`;
  if (_tripSelectSqlCache.key === cacheKey && _tripSelectSqlCache.sql) return _tripSelectSqlCache.sql;

  const startedAtSel = hasStartedCol ? ', t.driver_started_at_utc' : ', NULL AS driver_started_at_utc';
  const vehicleSel = hasDrvVeh
    ? `, drv.driver_car_plate AS accepted_driver_car_plate,
    drv.driver_car_front_url AS accepted_driver_car_front_url,
    drv.driver_car_back_url AS accepted_driver_car_back_url`
    : '';
  const teamSel = hasCrm
    ? `, IF(eo_req.crm_json IS NOT NULL AND JSON_VALID(eo_req.crm_json), NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(eo_req.crm_json, '$.team'))), ''), NULL) AS requester_team_name`
    : `, NULL AS requester_team_name`;
  const eoJoin = hasCrm
    ? `LEFT JOIN cln_employee_operator eo_req ON eo_req.employee_id = t.requester_employee_id AND eo_req.operator_id = t.operator_id`
    : '';
  const sql = `SELECT t.id,
    t.operator_id, t.requester_employee_id, t.requester_email,
    t.pickup_text, t.dropoff_text, t.schedule_offset, t.order_time_utc,
    t.business_time_zone, t.status, t.fulfillment_type,
    t.accepted_driver_employee_id, t.accepted_at_utc${startedAtSel},
    t.grab_car_plate, t.grab_phone, t.grab_proof_image_url,
    t.grab_booked_by_email, t.grab_booked_at_utc,
    t.completed_at_utc,
    t.created_at_utc, t.updated_at_utc,
    req.full_name AS requester_full_name,
    drv.full_name AS accepted_driver_full_name,
    drv.phone AS accepted_driver_phone,
    drv.avatar_url AS accepted_driver_avatar_url
    ${vehicleSel}
    ${teamSel}
   FROM cln_driver_trip t
   LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
   LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
   ${eoJoin}`;
  _tripSelectSqlCache = { key: cacheKey, sql };
  return sql;
}

async function getEmployeeIdByEmail(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const [rows] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [em]
  );
  return rows?.[0]?.id ? String(rows[0].id) : null;
}

async function assertEmailIsDriverForOperator(email, operatorId) {
  const oid = String(operatorId || '').trim();
  const ctx = await accessSvc.getCleanlemonsPortalContext(email);
  for (const eo of ctx.employeeOperators || []) {
    if (String(eo.operatorId) === oid && String(eo.staffRole || '').toLowerCase() === 'driver') {
      return true;
    }
  }
  const err = new Error('DRIVER_ROLE_REQUIRED');
  err.code = 'DRIVER_ROLE_REQUIRED';
  throw err;
}

async function hasColumn(table, column) {
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
      [table, column]
    );
    return Number(rows?.[0]?.c) > 0;
  } catch {
    return false;
  }
}

/**
 * @param {{ email: string, operatorId: string, pickup: string, dropoff: string, scheduleOffset: string, orderTimeIso: string }} p
 */
async function createDriverTrip(p) {
  const operatorId = String(p.operatorId || '').trim();
  const pickup = String(p.pickup || '').trim();
  const dropoff = String(p.dropoff || '').trim();
  if (!operatorId || !pickup || !dropoff) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  if (pickup === dropoff) {
    const e = new Error('PICKUP_DROPOFF_SAME');
    e.code = 'PICKUP_DROPOFF_SAME';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(operatorId, p.email);
  const employeeId = await getEmployeeIdByEmail(p.email);
  if (!employeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    const e = new Error('MIGRATION_REQUIRED');
    e.code = 'MIGRATION_REQUIRED';
    throw e;
  }
  const scheduleOffset = normalizeScheduleOffset(p.scheduleOffset);
  let orderTime = p.orderTimeIso ? new Date(String(p.orderTimeIso)) : new Date();
  if (Number.isNaN(orderTime.getTime())) orderTime = new Date();

  const [activeRows] = await pool.query(
    `SELECT id FROM cln_driver_trip
     WHERE requester_employee_id = ? AND operator_id = ? AND status IN ('pending','driver_accepted','grab_booked')
     LIMIT 1`,
    [employeeId, operatorId]
  );
  if (activeRows?.length) {
    const e = new Error('ACTIVE_TRIP_EXISTS');
    e.code = 'ACTIVE_TRIP_EXISTS';
    throw e;
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO cln_driver_trip (
       id, operator_id, requester_employee_id, requester_email,
       pickup_text, dropoff_text, schedule_offset, order_time_utc,
       business_time_zone, status, fulfillment_type
     ) VALUES (?,?,?,?,?,?,?,?,?,'pending','none')`,
    [
      id,
      operatorId,
      employeeId,
      String(p.email || '').trim().toLowerCase(),
      pickup.slice(0, 2000),
      dropoff.slice(0, 2000),
      scheduleOffset,
      orderTime,
      'Asia/Kuala_Lumpur',
    ]
  );
  const sql = await getTripSelectSql();
  const [[row]] = await pool.query(`${sql} WHERE t.id = ? LIMIT 1`, [id]);
  return { ok: true, trip: mapTripRow(row) };
}

async function getActiveTripForEmployee({ email, operatorId }) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  const employeeId = await getEmployeeIdByEmail(email);
  if (!employeeId) return { ok: true, trip: null };
  try {
    const sql = await getTripSelectSql();
    const [rows] = await pool.query(
      `${sql}
       WHERE t.requester_employee_id = ? AND t.operator_id = ?
         AND t.status IN ('pending','driver_accepted','grab_booked')
       ORDER BY t.created_at_utc DESC
       LIMIT 1`,
      [employeeId, oid]
    );
    return { ok: true, trip: rows?.[0] ? mapTripRow(rows[0]) : null };
  } catch (err) {
    if (isNoSuchTable(err)) return { ok: true, trip: null, reason: 'TABLE_MISSING' };
    throw err;
  }
}

async function cancelDriverTrip({ email, operatorId, tripId }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  const employeeId = await getEmployeeIdByEmail(email);
  if (!employeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }
  const [[row]] = await pool.query(
    'SELECT id, status, requester_employee_id FROM cln_driver_trip WHERE id = ? AND operator_id = ? LIMIT 1',
    [tid, oid]
  );
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (String(row.requester_employee_id) !== employeeId) {
    const e = new Error('FORBIDDEN');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (!ACTIVE_STATUSES.has(String(row.status))) {
    const e = new Error('TRIP_NOT_CANCELLABLE');
    e.code = 'TRIP_NOT_CANCELLABLE';
    throw e;
  }
  await pool.query(
    `UPDATE cln_driver_trip SET status = 'cancelled', updated_at_utc = CURRENT_TIMESTAMP(3) WHERE id = ? LIMIT 1`,
    [tid]
  );
  return { ok: true };
}

async function listTripsForOperator({ email, operatorId, statusFilter, limit = 100 }) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  let where = 't.operator_id = ?';
  const params = [oid];
  const sf = String(statusFilter || '').trim().toLowerCase();
  if (sf && sf !== 'all') {
    where += ' AND t.status = ?';
    params.push(sf);
  }
  try {
    const sql = await getTripSelectSql();
    const [rows] = await pool.query(
      `${sql} WHERE ${where} ORDER BY t.created_at_utc DESC LIMIT ${lim}`,
      params
    );
    return { ok: true, items: (rows || []).map(mapTripRow) };
  } catch (err) {
    if (isNoSuchTable(err)) return { ok: true, items: [], reason: 'TABLE_MISSING' };
    throw err;
  }
}

async function listOpenTripsForDriver({ email, operatorId }) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  try {
    const sql = await getTripSelectSql();
    const [rows] = await pool.query(
      `${sql}
       WHERE t.operator_id = ? AND t.status = 'pending'
       ORDER BY t.order_time_utc ASC, t.created_at_utc ASC
       LIMIT 200`,
      [oid]
    );
    return { ok: true, items: (rows || []).map(mapTripRow) };
  } catch (err) {
    if (isNoSuchTable(err)) return { ok: true, items: [], reason: 'TABLE_MISSING' };
    throw err;
  }
}

async function acceptTripAsDriver({ email, operatorId, tripId }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[busy]] = await conn.query(
      `SELECT id FROM cln_driver_trip
       WHERE operator_id = ? AND accepted_driver_employee_id = ? AND status = 'driver_accepted'
       LIMIT 1 FOR UPDATE`,
      [oid, driverEmployeeId]
    );
    if (busy?.id) {
      const e = new Error('ACTIVE_TRIP_EXISTS');
      e.code = 'ACTIVE_TRIP_EXISTS';
      throw e;
    }
    const [[row]] = await conn.query(
      'SELECT id, status, requester_employee_id FROM cln_driver_trip WHERE id = ? AND operator_id = ? FOR UPDATE',
      [tid, oid]
    );
    if (!row) {
      const e = new Error('NOT_FOUND');
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (String(row.status) !== 'pending') {
      const e = new Error('TRIP_NOT_OPEN');
      e.code = 'TRIP_NOT_OPEN';
      throw e;
    }
    // Same employee may be requester + driver (e.g. internal run or testing); allow accept.
    await conn.query(
      `UPDATE cln_driver_trip SET
        status = 'driver_accepted',
        fulfillment_type = 'driver',
        accepted_driver_employee_id = ?,
        accepted_at_utc = CURRENT_TIMESTAMP(3),
        updated_at_utc = CURRENT_TIMESTAMP(3)
       WHERE id = ? LIMIT 1`,
      [driverEmployeeId, tid]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  const sql = await getTripSelectSql();
  const [[out]] = await pool.query(`${sql} WHERE t.id = ? LIMIT 1`, [tid]);
  return { ok: true, trip: mapTripRow(out) };
}

async function bookGrabForTrip({ email, operatorId, tripId, grabCarPlate, grabPhone, grabProofImageUrl }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  const plate = grabCarPlate != null ? String(grabCarPlate).trim().slice(0, 64) : '';
  const phone = grabPhone != null ? String(grabPhone).trim().slice(0, 64) : '';
  const proof = grabProofImageUrl != null ? String(grabProofImageUrl).trim().slice(0, 2000) : '';
  if (!plate && !phone && !proof) {
    const e = new Error('GRAB_DETAILS_REQUIRED');
    e.code = 'GRAB_DETAILS_REQUIRED';
    throw e;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, status FROM cln_driver_trip WHERE id = ? AND operator_id = ? FOR UPDATE',
      [tid, oid]
    );
    if (!row) {
      const e = new Error('NOT_FOUND');
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (String(row.status) !== 'pending') {
      const e = new Error('TRIP_NOT_OPEN');
      e.code = 'TRIP_NOT_OPEN';
      throw e;
    }
    const em = String(email || '').trim().toLowerCase();
    await conn.query(
      `UPDATE cln_driver_trip SET
        status = 'grab_booked',
        fulfillment_type = 'grab',
        grab_car_plate = ?,
        grab_phone = ?,
        grab_proof_image_url = ?,
        grab_booked_by_email = ?,
        grab_booked_at_utc = CURRENT_TIMESTAMP(3),
        updated_at_utc = CURRENT_TIMESTAMP(3)
       WHERE id = ? LIMIT 1`,
      [plate || null, phone || null, proof || null, em, tid]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  const sqlGrab = await getTripSelectSql();
  const [[out]] = await pool.query(`${sqlGrab} WHERE t.id = ? LIMIT 1`, [tid]);
  return { ok: true, trip: mapTripRow(out) };
}

async function getActiveTripForDriver({ email, operatorId }) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) return { ok: true, trip: null };
  try {
    const sql = await getTripSelectSql();
    const [[row]] = await pool.query(
      `${sql}
       WHERE t.operator_id = ? AND t.accepted_driver_employee_id = ? AND t.status = 'driver_accepted'
       ORDER BY t.accepted_at_utc DESC
       LIMIT 1`,
      [oid, driverEmployeeId]
    );
    return { ok: true, trip: row ? mapTripRow(row) : null };
  } catch (err) {
    if (isNoSuchTable(err)) return { ok: true, trip: null, reason: 'TABLE_MISSING' };
    throw err;
  }
}

async function startDriverTrip({ email, operatorId, tripId }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }
  const hasStartedCol = await hasColumn('cln_driver_trip', 'driver_started_at_utc');
  if (!hasStartedCol) {
    const e = new Error('MIGRATION_REQUIRED');
    e.code = 'MIGRATION_REQUIRED';
    throw e;
  }
  const [upd] = await pool.query(
    `UPDATE cln_driver_trip
     SET driver_started_at_utc = CURRENT_TIMESTAMP(3), updated_at_utc = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND operator_id = ? AND accepted_driver_employee_id = ?
       AND status = 'driver_accepted' AND driver_started_at_utc IS NULL`,
    [tid, oid, driverEmployeeId]
  );
  const n = Number(upd?.affectedRows ?? 0);
  if (!n) {
    const e = new Error('TRIP_START_DENIED');
    e.code = 'TRIP_START_DENIED';
    throw e;
  }
  const sql = await getTripSelectSql();
  const [[out]] = await pool.query(`${sql} WHERE t.id = ? LIMIT 1`, [tid]);
  return { ok: true, trip: mapTripRow(out) };
}

async function releaseDriverAcceptance({ email, operatorId, tripId }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }
  const hasStartedCol = await hasColumn('cln_driver_trip', 'driver_started_at_utc');
  const startedClause = hasStartedCol ? 'AND driver_started_at_utc IS NULL' : '';
  const [upd] = await pool.query(
    `UPDATE cln_driver_trip SET
       status = 'pending',
       fulfillment_type = 'none',
       accepted_driver_employee_id = NULL,
       accepted_at_utc = NULL,
       updated_at_utc = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND operator_id = ? AND accepted_driver_employee_id = ?
       AND status = 'driver_accepted' ${startedClause}`,
    [tid, oid, driverEmployeeId]
  );
  const n = Number(upd?.affectedRows ?? 0);
  if (!n) {
    const e = new Error('RELEASE_DENIED');
    e.code = 'RELEASE_DENIED';
    throw e;
  }
  return { ok: true };
}

async function finishTripAsDriver({ email, operatorId, tripId }) {
  const oid = String(operatorId || '').trim();
  const tid = String(tripId || '').trim();
  if (!oid || !tid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) {
    const e = new Error('EMPLOYEE_PROFILE_REQUIRED');
    e.code = 'EMPLOYEE_PROFILE_REQUIRED';
    throw e;
  }
  const hasCompleted = await hasColumn('cln_driver_trip', 'completed_at_utc');
  const hasStartedCol = await hasColumn('cln_driver_trip', 'driver_started_at_utc');
  const extra = hasCompleted ? ', completed_at_utc = CURRENT_TIMESTAMP(3)' : '';
  const startedReq = hasStartedCol ? 'AND driver_started_at_utc IS NOT NULL' : '';
  const [upd] = await pool.query(
    `UPDATE cln_driver_trip
     SET status = 'completed', updated_at_utc = CURRENT_TIMESTAMP(3) ${extra}
     WHERE id = ? AND operator_id = ? AND accepted_driver_employee_id = ?
       AND status = 'driver_accepted' ${startedReq}`,
    [tid, oid, driverEmployeeId]
  );
  const n = Number(upd?.affectedRows ?? 0);
  if (!n) {
    const e = new Error(hasStartedCol ? 'TRIP_NOT_STARTED' : 'TRIP_FINISH_DENIED');
    e.code = hasStartedCol ? 'TRIP_NOT_STARTED' : 'TRIP_FINISH_DENIED';
    throw e;
  }
  const sqlFin = await getTripSelectSql();
  const [[out]] = await pool.query(`${sqlFin} WHERE t.id = ? LIMIT 1`, [tid]);
  return { ok: true, trip: mapTripRow(out) };
}

async function listCompletedTripsForDriver({ email, operatorId, limit = 50 }) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  await clnSvc.assertClnOperatorStaffEmail(oid, email);
  await assertEmailIsDriverForOperator(email, oid);
  const driverEmployeeId = await getEmployeeIdByEmail(email);
  if (!driverEmployeeId) return { ok: true, items: [] };
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    const sql = await getTripSelectSql();
    const [rows] = await pool.query(
      `${sql}
       WHERE t.operator_id = ? AND t.accepted_driver_employee_id = ? AND t.status = 'completed'
       ORDER BY t.updated_at_utc DESC, t.created_at_utc DESC
       LIMIT ${lim}`,
      [oid, driverEmployeeId]
    );
    return { ok: true, items: (rows || []).map(mapTripRow) };
  } catch (err) {
    if (isNoSuchTable(err)) return { ok: true, items: [], reason: 'TABLE_MISSING' };
    throw err;
  }
}

module.exports = {
  createDriverTrip,
  getActiveTripForEmployee,
  cancelDriverTrip,
  listTripsForOperator,
  listOpenTripsForDriver,
  acceptTripAsDriver,
  bookGrabForTrip,
  getActiveTripForDriver,
  startDriverTrip,
  releaseDriverAcceptance,
  finishTripAsDriver,
  listCompletedTripsForDriver,
};
