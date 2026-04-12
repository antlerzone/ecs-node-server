/**
 * Cleanlemons operator contacts: persist new rows to cln_employeedetail + cln_employee_operator
 * (staff/driver/dobi/supervisor → staff_role cleaner|driver|dobi|supervisor) or
 * cln_clientdetail + cln_client_operator (clients), Coliving-style single role per add.
 */

const contactSync = require('../contact/contact-sync.service');

function safeJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function databaseHasTable(pool, tableName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(row?.n) > 0;
}

async function databaseHasColumn(pool, tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(row?.n) > 0;
}

let _extrasEnsured = false;

async function ensureClnDomainContactExtras(pool) {
  if (_extrasEnsured) return;
  try {
    if (await databaseHasTable(pool, 'cln_employeedetail')) {
      if (!(await databaseHasColumn(pool, 'cln_employeedetail', 'account'))) {
        await pool.query('ALTER TABLE cln_employeedetail ADD COLUMN account LONGTEXT NULL');
      }
    }
    if (await databaseHasTable(pool, 'cln_employee_operator')) {
      if (!(await databaseHasColumn(pool, 'cln_employee_operator', 'crm_json'))) {
        await pool.query('ALTER TABLE cln_employee_operator ADD COLUMN crm_json LONGTEXT NULL');
      }
    }
    if (await databaseHasTable(pool, 'cln_client_operator')) {
      if (!(await databaseHasColumn(pool, 'cln_client_operator', 'crm_json'))) {
        await pool.query('ALTER TABLE cln_client_operator ADD COLUMN crm_json LONGTEXT NULL');
      }
    }
  } catch (e) {
    if (!/Duplicate column/i.test(String(e?.message || ''))) {
      console.warn('[cleanlemon] ensureClnDomainContactExtras:', e?.message || e);
    }
  }
  _extrasEnsured = true;
}

async function clnDomainContactSchemaReady(pool) {
  return (
    (await databaseHasTable(pool, 'cln_employeedetail')) &&
    (await databaseHasTable(pool, 'cln_employee_operator')) &&
    (await databaseHasTable(pool, 'cln_clientdetail')) &&
    (await databaseHasTable(pool, 'cln_client_operator'))
  );
}

const SINGLE_ROLES = new Set(['staff', 'driver', 'dobi', 'supervisor', 'clients']);

/** UI permission → cln_employee_operator.staff_role */
function staffRoleFromUiPermission(p) {
  const x = String(p || '').toLowerCase();
  if (x === 'staff') return 'cleaner';
  if (x === 'driver') return 'driver';
  if (x === 'dobi') return 'dobi';
  if (x === 'supervisor') return 'supervisor';
  return 'cleaner';
}

/** With multiple UI roles, pick one deterministic primary for the `staff_role` column. */
function primaryUiRoleFromPermissions(perms) {
  const order = ['supervisor', 'driver', 'dobi', 'staff'];
  const set = new Set((Array.isArray(perms) ? perms : []).map((x) => String(x).toLowerCase()));
  for (const o of order) {
    if (set.has(o)) return o;
  }
  return 'staff';
}

function permissionsFromStaffRole(sr) {
  const s = String(sr || '').toLowerCase();
  if (s === 'driver') return ['driver'];
  if (s === 'dobi') return ['dobi'];
  if (s === 'supervisor') return ['supervisor'];
  return ['staff'];
}

function crmStatusFromJson(crm) {
  const st = String(crm?.status || 'active').toLowerCase();
  return st || 'active';
}

function buildCrmFromInput(input) {
  const empFromPortal = Array.isArray(input.portalRoles)
    ? input.portalRoles
    : Array.isArray(input.permissions)
      ? input.permissions.filter((x) =>
          ['staff', 'driver', 'dobi', 'supervisor'].includes(String(x).toLowerCase())
        )
      : [];
  const portalRoles =
    empFromPortal.length > 0
      ? [...new Set(empFromPortal.map((x) => String(x).toLowerCase()))]
      : undefined;

  const base = {
    status: String(input.status || 'active'),
    joinedAt: input.joinedAt || null,
    employmentStatus: String(input.employmentStatus || 'full-time'),
    salaryBasic: Number(input.salaryBasic) || 0,
    team: input.team || null,
    bankName: String(input.bankName || ''),
    bankAccountNo: String(input.bankAccountNo || ''),
    icCopyUrl: input.icCopyUrl || '#',
    passportCopyUrl: input.passportCopyUrl || '#',
    offerLetterUrl: input.offerLetterUrl || null,
    workingWithUsCount: input.workingWithUsCount != null ? Number(input.workingWithUsCount) : null,
    trainings: Array.isArray(input.trainings) ? input.trainings : [],
    remarkHistory: Array.isArray(input.remarkHistory) ? input.remarkHistory : [],
  };
  if (portalRoles && portalRoles.length) base.portalRoles = portalRoles;
  return base;
}

function mapEmployeeJunctionToContact(eo, d, crm) {
  const c = crm && typeof crm === 'object' ? crm : {};
  const accountRaw = d.account != null && d.account !== '' ? safeJson(d.account, []) : [];
  const allowed = new Set(['staff', 'driver', 'dobi', 'supervisor']);
  let permOut = permissionsFromStaffRole(eo.staff_role);
  if (Array.isArray(c.portalRoles) && c.portalRoles.length) {
    const fromCrm = [
      ...new Set(
        c.portalRoles.map((x) => String(x).toLowerCase()).filter((x) => allowed.has(x))
      ),
    ];
    if (fromCrm.length) permOut = fromCrm;
  }
  return {
    id: String(eo.id),
    employeeDetailId: eo.employee_id != null ? String(eo.employee_id) : undefined,
    operatorId: eo.operator_id != null ? String(eo.operator_id) : undefined,
    name: String(d.full_name || '').trim() || String(d.email || ''),
    email: String(d.email || ''),
    phone: (d.phone != null && String(d.phone).trim() !== '' ? String(d.phone) : '-') || '-',
    permissions: permOut,
    account: Array.isArray(accountRaw) ? accountRaw : [],
    status: crmStatusFromJson(c),
    joinedAt: c.joinedAt ? String(c.joinedAt).slice(0, 10) : '',
    employmentStatus: c.employmentStatus || 'full-time',
    salaryBasic: Number(c.salaryBasic) || 0,
    team: c.team || undefined,
    bankName: c.bankName || '',
    bankAccountNo: c.bankAccountNo || '',
    icCopyUrl: c.icCopyUrl || '#',
    passportCopyUrl: c.passportCopyUrl || '#',
    offerLetterUrl: c.offerLetterUrl || undefined,
    workingWithUsCount: c.workingWithUsCount != null ? Number(c.workingWithUsCount) : undefined,
    trainings: Array.isArray(c.trainings) ? c.trainings : [],
    remarkHistory: Array.isArray(c.remarkHistory) ? c.remarkHistory : [],
    contactSource: 'employee',
  };
}

function mapClientJunctionToContact(co, cd, crm) {
  const c = crm && typeof crm === 'object' ? crm : {};
  const accountRaw = cd.account != null && cd.account !== '' ? safeJson(cd.account, []) : [];
  return {
    id: String(co.id),
    clientDetailId: co.clientdetail_id != null ? String(co.clientdetail_id) : undefined,
    operatorId: co.operator_id != null ? String(co.operator_id) : undefined,
    name: String(cd.fullname || '').trim() || String(cd.email || ''),
    email: String(cd.email || ''),
    phone: (cd.phone != null && String(cd.phone).trim() !== '' ? String(cd.phone) : '-') || '-',
    permissions: ['clients'],
    account: Array.isArray(accountRaw) ? accountRaw : [],
    status: crmStatusFromJson(c),
    joinedAt: c.joinedAt ? String(c.joinedAt).slice(0, 10) : '',
    employmentStatus: c.employmentStatus || 'full-time',
    salaryBasic: Number(c.salaryBasic) || 0,
    team: c.team || undefined,
    bankName: c.bankName || '',
    bankAccountNo: c.bankAccountNo || '',
    icCopyUrl: c.icCopyUrl || '#',
    passportCopyUrl: c.passportCopyUrl || '#',
    offerLetterUrl: c.offerLetterUrl || undefined,
    workingWithUsCount: c.workingWithUsCount != null ? Number(c.workingWithUsCount) : undefined,
    trainings: Array.isArray(c.trainings) ? c.trainings : [],
    remarkHistory: Array.isArray(c.remarkHistory) ? c.remarkHistory : [],
    contactSource: 'client',
    accountingContactId:
      c.accountingContactId != null && String(c.accountingContactId).trim() !== ''
        ? String(c.accountingContactId).trim()
        : undefined,
    accountingProvider:
      c.accountingProvider != null && String(c.accountingProvider).trim() !== ''
        ? String(c.accountingProvider).trim().toLowerCase()
        : undefined,
  };
}

async function loadEmployeeContactsForOperator(pool, operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid || !(await databaseHasTable(pool, 'cln_employee_operator'))) return [];
  const hasCrm = await databaseHasColumn(pool, 'cln_employee_operator', 'crm_json');
  const crmSel = hasCrm ? 'eo.crm_json' : 'NULL AS crm_json';
  try {
    const [rows] = await pool.query(
      `SELECT eo.id, eo.operator_id, eo.staff_role, eo.employee_id AS employee_id, ${crmSel},
              d.email, d.full_name, d.phone, d.account, d.updated_at
       FROM cln_employee_operator eo
       INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
       WHERE eo.operator_id = ?
       ORDER BY d.updated_at DESC`,
      [oid]
    );
    return rows.map((r) => mapEmployeeJunctionToContact(r, r, safeJson(r.crm_json, {})));
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') return [];
    console.warn('[cleanlemon] loadEmployeeContactsForOperator', e?.message || e);
    return [];
  }
}

async function loadClientContactsForOperator(pool, operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid || !(await databaseHasTable(pool, 'cln_client_operator'))) return [];
  const hasCrm = await databaseHasColumn(pool, 'cln_client_operator', 'crm_json');
  const crmSel = hasCrm ? 'co.crm_json' : 'NULL AS crm_json';
  try {
    const [rows] = await pool.query(
      `SELECT co.id, co.operator_id, co.clientdetail_id, ${crmSel},
              cd.email, cd.fullname, cd.phone, cd.account, cd.updated_at
       FROM cln_client_operator co
       INNER JOIN cln_clientdetail cd ON cd.id = co.clientdetail_id
       WHERE co.operator_id = ?
       ORDER BY cd.updated_at DESC`,
      [oid]
    );
    return rows.map((r) =>
      mapClientJunctionToContact(
        r,
        { email: r.email, fullname: r.fullname, phone: r.phone, account: r.account },
        safeJson(r.crm_json, {})
      )
    );
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') return [];
    console.warn('[cleanlemon] loadClientContactsForOperator', e?.message || e);
    return [];
  }
}

async function assertDomainEmailUnique(pool, email, operatorId, excludeJunctionId) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  const oid = String(operatorId || '').trim();
  if (!e || !oid) return;

  const [eoDup] = await pool.query(
    `SELECT eo.id, eo.crm_json FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ?`,
    [oid, e]
  );
  for (const r of eoDup) {
    if (excludeJunctionId != null && String(r.id) === String(excludeJunctionId)) continue;
    const st = crmStatusFromJson(safeJson(r.crm_json, {}));
    if (st !== 'active') continue;
    const err = new Error('EMAIL_IN_USE');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }

  const [coDup] = await pool.query(
    `SELECT co.id, co.crm_json FROM cln_client_operator co
     INNER JOIN cln_clientdetail cd ON cd.id = co.clientdetail_id
     WHERE co.operator_id = ? AND LOWER(TRIM(cd.email)) = ?`,
    [oid, e]
  );
  for (const r of coDup) {
    if (excludeJunctionId != null && String(r.id) === String(excludeJunctionId)) continue;
    const st = crmStatusFromJson(safeJson(r.crm_json, {}));
    if (st !== 'active') continue;
    const err = new Error('EMAIL_IN_USE');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
}

async function pushEmployeeAccounting(pool, getClnAccountProviderForOperator, operatorId, employeeId, perms, rec) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: true, skipped: true };
  const provider = await getClnAccountProviderForOperator(oid);
  if (!provider) return { ok: true, skipped: true };

  const p = Array.isArray(perms) ? perms : [];
  const accRoles = [];
  if (p.some((x) => ['staff', 'driver', 'dobi', 'supervisor'].includes(String(x).toLowerCase())))
    accRoles.push('staff');
  if (p.includes('clients')) accRoles.push('tenant');
  if (!accRoles.length) return { ok: true, skipped: true, reason: 'NO_ACCOUNTING_ROLE' };

  const [dRows] = await pool.query('SELECT account FROM cln_employeedetail WHERE id = ? LIMIT 1', [employeeId]);
  let account = safeJson(dRows[0]?.account, []);
  if (!Array.isArray(account)) account = [];
  const existing = account.find(
    (a) => a?.clientId === oid && String(a?.provider || '').toLowerCase() === provider
  );
  let existingId = existing?.id || existing?.contactId || null;
  const phoneRaw = rec.phone != null && String(rec.phone).trim() !== '-' ? String(rec.phone).trim() : '';
  const failures = [];
  for (const role of accRoles) {
    const syncRes = await contactSync.ensureContactInAccounting(oid, provider, role, rec, existingId);
    if (!syncRes.ok || !syncRes.contactId) {
      failures.push({ role, reason: syncRes.reason || 'SYNC_FAILED' });
      break;
    }
    existingId = String(syncRes.contactId);
    account = contactSync.mergeAccountEntry(account, oid, provider, syncRes.contactId);
  }
  if (failures.length) {
    return { ok: false, failures, provider };
  }
  await pool.query('UPDATE cln_employeedetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    JSON.stringify(account),
    employeeId,
  ]);
  return { ok: true, provider };
}

/**
 * Mirror Bukku/Xero/etc. tenant/customer contact id on `cln_client_operator.crm_json`
 * (in addition to `cln_clientdetail.account` merged by `pushClientAccounting`).
 */
async function mergeClientOperatorJunctionAccountingCrm(pool, operatorId, clientdetailId, provider, contactId) {
  const oid = String(operatorId || '').trim();
  const cid = String(clientdetailId || '').trim();
  const prov = String(provider || '').trim().toLowerCase();
  const ctc = String(contactId || '').trim();
  if (!oid || !cid || !prov || !ctc) return { ok: false, skipped: true };
  if (!(await databaseHasTable(pool, 'cln_client_operator'))) return { ok: false, skipped: true };
  const hasCrm = await databaseHasColumn(pool, 'cln_client_operator', 'crm_json');
  if (!hasCrm) return { ok: true, skipped: true };
  const [[row]] = await pool.query(
    'SELECT id, crm_json FROM cln_client_operator WHERE operator_id = ? AND clientdetail_id = ? LIMIT 1',
    [oid, cid]
  );
  if (!row) return { ok: false, reason: 'JUNCTION_NOT_FOUND' };
  const crm = safeJson(row.crm_json, {});
  const next = {
    ...crm,
    accountingProvider: prov,
    accountingContactId: ctc,
  };
  await pool.query('UPDATE cln_client_operator SET crm_json = ? WHERE id = ?', [JSON.stringify(next), row.id]);
  return { ok: true };
}

async function pushClientAccounting(pool, getClnAccountProviderForOperator, operatorId, clientdetailId, rec) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: true, skipped: true };
  const provider = await getClnAccountProviderForOperator(oid);
  if (!provider) return { ok: true, skipped: true };

  const accRoles = ['tenant'];
  const [dRows] = await pool.query('SELECT account FROM cln_clientdetail WHERE id = ? LIMIT 1', [clientdetailId]);
  let account = safeJson(dRows[0]?.account, []);
  if (!Array.isArray(account)) account = [];
  const existing = account.find(
    (a) => a?.clientId === oid && String(a?.provider || '').toLowerCase() === provider
  );
  let existingId = existing?.id || existing?.contactId || null;
  const failures = [];
  for (const role of accRoles) {
    const syncRes = await contactSync.ensureContactInAccounting(oid, provider, role, rec, existingId);
    if (!syncRes.ok || !syncRes.contactId) {
      failures.push({ role, reason: syncRes.reason || 'SYNC_FAILED' });
      break;
    }
    existingId = String(syncRes.contactId);
    account = contactSync.mergeAccountEntry(account, oid, provider, syncRes.contactId);
  }
  if (failures.length) return { ok: false, failures, provider };
  await pool.query('UPDATE cln_clientdetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    JSON.stringify(account),
    clientdetailId,
  ]);
  try {
    await mergeClientOperatorJunctionAccountingCrm(pool, oid, clientdetailId, provider, existingId);
  } catch (e) {
    console.warn('[cleanlemon] mergeClientOperatorJunctionAccountingCrm', e?.message || e);
  }
  return { ok: true, provider, contactId: existingId };
}

async function createEmployeeContactDomain(pool, getClnAccountProviderForOperator, input) {
  const opId = String(input.operatorId || input.operator_id || '').trim();
  if (!opId) {
    const err = new Error('NO_OPERATOR_ID');
    err.code = 'NO_OPERATOR_ID';
    throw err;
  }
  const permsArr = Array.isArray(input.permissions) ? input.permissions : [];
  const picked = [...new Set(permsArr.map((x) => String(x).toLowerCase()))].filter((p) => SINGLE_ROLES.has(p));
  if (picked.includes('clients')) {
    const err = new Error('SINGLE_ROLE_REQUIRED');
    err.code = 'SINGLE_ROLE_REQUIRED';
    err.message = 'B2B clients must be created as contact type Client';
    throw err;
  }
  const employeePicked = picked.filter((p) => p !== 'clients');
  if (employeePicked.length < 1) {
    const err = new Error('SINGLE_ROLE_REQUIRED');
    err.code = 'SINGLE_ROLE_REQUIRED';
    err.message = 'Select at least one employee role (staff, driver, dobi, supervisor)';
    throw err;
  }
  const primaryUi = primaryUiRoleFromPermissions(employeePicked);
  const staffRole = staffRoleFromUiPermission(primaryUi);
  const emailNorm = String(input.email || '')
    .trim()
    .toLowerCase();
  if (!emailNorm && employeePicked.includes('supervisor')) {
    const err = new Error('NO_EMAIL');
    err.code = 'NO_EMAIL';
    throw err;
  }

  let employeeId;
  if (emailNorm) {
    await assertDomainEmailUnique(pool, emailNorm, opId, null);

    const [existEmp] = await pool.query(
      'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [emailNorm]
    );
    if (!existEmp.length) {
      employeeId = require('crypto').randomUUID();
      await pool.query(
        `INSERT INTO cln_employeedetail (id, email, full_name, phone, account, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          employeeId,
          emailNorm,
          String(input.name || '').trim(),
          String(input.phone || '').trim() && String(input.phone).trim() !== '-'
            ? String(input.phone).trim()
            : null,
          '[]',
        ]
      );
    } else {
      employeeId = existEmp[0].id;
      await pool.query(
        `UPDATE cln_employeedetail SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [
          String(input.name || '').trim(),
          String(input.phone || '').trim() && String(input.phone).trim() !== '-'
            ? String(input.phone).trim()
            : null,
          employeeId,
        ]
      );
    }
  } else {
    employeeId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO cln_employeedetail (id, email, full_name, phone, account, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        employeeId,
        null,
        String(input.name || '').trim(),
        String(input.phone || '').trim() && String(input.phone).trim() !== '-'
          ? String(input.phone).trim()
          : null,
        '[]',
      ]
    );
  }

  const [eoDup] = await pool.query(
    'SELECT id FROM cln_employee_operator WHERE employee_id = ? AND operator_id = ? LIMIT 1',
    [employeeId, opId]
  );
  if (eoDup.length) {
    const err = new Error('EMAIL_IN_USE');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }

  const junctionId = require('crypto').randomUUID();
  const crm = buildCrmFromInput({ ...input, portalRoles: employeePicked });
  const hasCrm = await databaseHasColumn(pool, 'cln_employee_operator', 'crm_json');
  if (hasCrm) {
    await pool.query(
      `INSERT INTO cln_employee_operator (id, employee_id, operator_id, staff_role, crm_json, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [junctionId, employeeId, opId, staffRole, JSON.stringify(crm)]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_employee_operator (id, employee_id, operator_id, staff_role, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [junctionId, employeeId, opId, staffRole]
    );
  }

  if (input.skipAccountingPush) {
    const accIn = input.account != null ? (Array.isArray(input.account) ? input.account : safeJson(input.account, [])) : null;
    if (accIn != null && Array.isArray(accIn)) {
      await pool.query(
        `UPDATE cln_employeedetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [JSON.stringify(accIn), employeeId]
      );
    }
  } else {
    try {
      await pushEmployeeAccounting(pool, getClnAccountProviderForOperator, opId, employeeId, employeePicked, {
        name: String(input.name || ''),
        email: emailNorm,
        phone: input.phone != null && String(input.phone).trim() !== '-' ? String(input.phone).trim() : '',
      });
    } catch (e) {
      console.warn('[cleanlemon] createEmployeeContactDomain accounting', e?.message || e);
    }
  }

  return junctionId;
}

async function createClientContactDomain(pool, getClnAccountProviderForOperator, input) {
  const opId = String(input.operatorId || input.operator_id || '').trim();
  if (!opId) {
    const err = new Error('NO_OPERATOR_ID');
    err.code = 'NO_OPERATOR_ID';
    throw err;
  }
  const permsArr = Array.isArray(input.permissions) ? input.permissions : [];
  if (permsArr.length !== 1 || String(permsArr[0]).toLowerCase() !== 'clients') {
    const err = new Error('SINGLE_ROLE_REQUIRED');
    err.code = 'SINGLE_ROLE_REQUIRED';
    throw err;
  }
  const emailNorm = String(input.email || '')
    .trim()
    .toLowerCase();

  let clientdetailId;
  if (emailNorm) {
    await assertDomainEmailUnique(pool, emailNorm, opId, null);

    const [existCd] = await pool.query(
      'SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [emailNorm]
    );
    if (!existCd.length) {
      clientdetailId = require('crypto').randomUUID();
      await pool.query(
        `INSERT INTO cln_clientdetail (id, email, fullname, phone, account, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [
          clientdetailId,
          emailNorm,
          String(input.name || '').trim(),
          String(input.phone || '').trim() && String(input.phone).trim() !== '-'
            ? String(input.phone).trim()
            : null,
          '[]',
        ]
      );
    } else {
      clientdetailId = existCd[0].id;
      await pool.query(
        `UPDATE cln_clientdetail SET fullname = ?, phone = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [
          String(input.name || '').trim(),
          String(input.phone || '').trim() && String(input.phone).trim() !== '-'
            ? String(input.phone).trim()
            : null,
          clientdetailId,
        ]
      );
    }
  } else {
    clientdetailId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO cln_clientdetail (id, email, fullname, phone, account, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        clientdetailId,
        null,
        String(input.name || '').trim(),
        String(input.phone || '').trim() && String(input.phone).trim() !== '-'
          ? String(input.phone).trim()
          : null,
        '[]',
      ]
    );
  }

  const [coDup] = await pool.query(
    'SELECT id FROM cln_client_operator WHERE clientdetail_id = ? AND operator_id = ? LIMIT 1',
    [clientdetailId, opId]
  );
  if (coDup.length) {
    const err = new Error('EMAIL_IN_USE');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }

  const junctionId = require('crypto').randomUUID();
  const crm = buildCrmFromInput(input);
  const hasCrm = await databaseHasColumn(pool, 'cln_client_operator', 'crm_json');
  if (hasCrm) {
    await pool.query(
      `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, crm_json, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [junctionId, clientdetailId, opId, JSON.stringify(crm)]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [junctionId, clientdetailId, opId]
    );
  }

  if (input.skipAccountingPush) {
    const accIn = input.account != null ? (Array.isArray(input.account) ? input.account : safeJson(input.account, [])) : null;
    if (accIn != null && Array.isArray(accIn)) {
      await pool.query(
        `UPDATE cln_clientdetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [JSON.stringify(accIn), clientdetailId]
      );
    }
  } else {
    try {
      await pushClientAccounting(pool, getClnAccountProviderForOperator, opId, clientdetailId, {
        name: String(input.name || ''),
        email: emailNorm,
        phone: input.phone != null && String(input.phone).trim() !== '-' ? String(input.phone).trim() : '',
      });
    } catch (e) {
      console.warn('[cleanlemon] createClientContactDomain accounting', e?.message || e);
    }
  }

  return junctionId;
}

async function createOperatorContactDomain(pool, getClnAccountProviderForOperator, input) {
  await ensureClnDomainContactExtras(pool);
  const permsArr = Array.isArray(input.permissions) ? input.permissions : [];
  const picked = [...new Set(permsArr.map((x) => String(x).toLowerCase()))].filter((p) => SINGLE_ROLES.has(p));
  const employeePicked = picked.filter((p) => p !== 'clients');
  if (picked.includes('clients')) {
    if (picked.length !== 1) {
      const err = new Error('SINGLE_ROLE_REQUIRED');
      err.code = 'SINGLE_ROLE_REQUIRED';
      err.message = 'B2B client contacts must have only the clients role';
      throw err;
    }
    return createClientContactDomain(pool, getClnAccountProviderForOperator, input);
  }
  if (employeePicked.length < 1) {
    const err = new Error('SINGLE_ROLE_REQUIRED');
    err.code = 'SINGLE_ROLE_REQUIRED';
    err.message = 'Select at least one employee role';
    throw err;
  }
  return createEmployeeContactDomain(pool, getClnAccountProviderForOperator, input);
}

async function getEmployeeJunctionRow(pool, junctionId) {
  const hasCrm = await databaseHasColumn(pool, 'cln_employee_operator', 'crm_json');
  const crmSel = hasCrm ? 'eo.crm_json' : 'NULL AS crm_json';
  const [rows] = await pool.query(
    `SELECT eo.id, eo.operator_id, eo.staff_role, eo.employee_id, ${crmSel},
            d.email, d.full_name, d.phone, d.account
     FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.id = ? LIMIT 1`,
    [String(junctionId)]
  );
  return rows[0] || null;
}

async function getClientJunctionRow(pool, junctionId) {
  const hasCrm = await databaseHasColumn(pool, 'cln_client_operator', 'crm_json');
  const crmSel = hasCrm ? 'co.crm_json' : 'NULL AS crm_json';
  const [rows] = await pool.query(
    `SELECT co.id, co.operator_id, co.clientdetail_id, ${crmSel},
            cd.email, cd.fullname, cd.phone, cd.account
     FROM cln_client_operator co
     INNER JOIN cln_clientdetail cd ON cd.id = co.clientdetail_id
     WHERE co.id = ? LIMIT 1`,
    [String(junctionId)]
  );
  return rows[0] || null;
}

async function updateOperatorContactDomain(
  pool,
  getClnAccountProviderForOperator,
  junctionId,
  input,
  assertSupervisorEmailAvailable
) {
  await ensureClnDomainContactExtras(pool);
  const id = String(junctionId);
  const er = await getEmployeeJunctionRow(pool, id);
  if (er) {
    const cur = mapEmployeeJunctionToContact(er, er, safeJson(er.crm_json, {}));
    if (input.status != null && String(input.status) === 'archived') {
      if (String(cur.status) !== 'resigned') {
        const err = new Error('ARCHIVE_REQUIRES_RESIGN');
        err.code = 'ARCHIVE_REQUIRES_RESIGN';
        throw err;
      }
    }
    let mergedPerms = input.permissions != null ? input.permissions : cur.permissions;
    mergedPerms = Array.isArray(mergedPerms)
      ? [...new Set(mergedPerms.map((x) => String(x).toLowerCase()))].filter((x) =>
          ['staff', 'driver', 'dobi', 'supervisor'].includes(x)
        )
      : cur.permissions;
    if (!Array.isArray(mergedPerms) || mergedPerms.length < 1) {
      const err = new Error('SINGLE_ROLE_REQUIRED');
      err.code = 'SINGLE_ROLE_REQUIRED';
      err.message = 'Select at least one employee role';
      throw err;
    }
    const m = {
      ...cur,
      ...input,
      permissions: mergedPerms,
      trainings: input.trainings != null ? input.trainings : cur.trainings,
      remarkHistory: input.remarkHistory != null ? input.remarkHistory : cur.remarkHistory,
      account: input.account != null ? input.account : cur.account,
    };
    if (Array.isArray(m.permissions) && m.permissions.includes('supervisor')) {
      await assertSupervisorEmailAvailable(String(m.email || ''), id);
    }
    const effOpId = String(m.operatorId || er.operator_id || '').trim();
    await assertDomainEmailUnique(pool, String(m.email || ''), effOpId, id);
    const emailNorm = String(m.email || '')
      .trim()
      .toLowerCase();
    if (!emailNorm && String(m.permissions || []).map((x) => String(x).toLowerCase()).includes('supervisor')) {
      const err = new Error('NO_EMAIL');
      err.code = 'NO_EMAIL';
      throw err;
    }
    await pool.query(
      `UPDATE cln_employeedetail SET email = ?, full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [
        emailNorm || null,
        String(m.name || '').trim(),
        m.phone != null && String(m.phone).trim() !== '-' ? String(m.phone).trim() : null,
        er.employee_id,
      ]
    );
    const accountJson =
      m.account != null ? JSON.stringify(Array.isArray(m.account) ? m.account : safeJson(m.account, [])) : null;
    if (accountJson != null) {
      await pool.query(
        `UPDATE cln_employeedetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [accountJson, er.employee_id]
      );
    }
    const crm = buildCrmFromInput({
      ...m,
      portalRoles: mergedPerms,
      status: m.status,
      joinedAt: m.joinedAt,
      employmentStatus: m.employmentStatus,
      salaryBasic: m.salaryBasic,
      team: m.team,
      bankName: m.bankName,
      bankAccountNo: m.bankAccountNo,
      icCopyUrl: m.icCopyUrl,
      passportCopyUrl: m.passportCopyUrl,
      offerLetterUrl: m.offerLetterUrl,
      workingWithUsCount: m.workingWithUsCount,
      trainings: m.trainings,
      remarkHistory: m.remarkHistory,
    });
    const primaryUi = primaryUiRoleFromPermissions(mergedPerms);
    const newStaffRole = staffRoleFromUiPermission(primaryUi);
    const hasCrm = await databaseHasColumn(pool, 'cln_employee_operator', 'crm_json');
    if (hasCrm) {
      await pool.query(`UPDATE cln_employee_operator SET staff_role = ?, crm_json = ? WHERE id = ?`, [
        newStaffRole,
        JSON.stringify(crm),
        id,
      ]);
    } else {
      await pool.query(`UPDATE cln_employee_operator SET staff_role = ? WHERE id = ?`, [newStaffRole, id]);
    }
    try {
      await pushEmployeeAccounting(pool, getClnAccountProviderForOperator, effOpId, er.employee_id, m.permissions, {
        name: String(m.name || ''),
        email: emailNorm,
        phone: m.phone != null && String(m.phone).trim() !== '-' ? String(m.phone).trim() : '',
      });
    } catch (e) {
      console.warn('[cleanlemon] updateOperatorContactDomain employee accounting', e?.message || e);
    }
    return;
  }

  const cr = await getClientJunctionRow(pool, id);
  if (cr) {
    const cur = mapClientJunctionToContact(
      cr,
      { email: cr.email, fullname: cr.fullname, phone: cr.phone, account: cr.account },
      safeJson(cr.crm_json, {})
    );
    const m = {
      ...cur,
      ...input,
      permissions: ['clients'],
      trainings: input.trainings != null ? input.trainings : cur.trainings,
      remarkHistory: input.remarkHistory != null ? input.remarkHistory : cur.remarkHistory,
      account: input.account != null ? input.account : cur.account,
    };
    const effOpId = String(m.operatorId || cr.operator_id || '').trim();
    await assertDomainEmailUnique(pool, String(m.email || ''), effOpId, id);
    const emailNorm = String(m.email || '')
      .trim()
      .toLowerCase();
    await pool.query(
      `UPDATE cln_clientdetail SET email = ?, fullname = ?, phone = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [
        emailNorm || null,
        String(m.name || '').trim(),
        m.phone != null && String(m.phone).trim() !== '-' ? String(m.phone).trim() : null,
        cr.clientdetail_id,
      ]
    );
    const accountJson =
      m.account != null ? JSON.stringify(Array.isArray(m.account) ? m.account : safeJson(m.account, [])) : null;
    if (accountJson != null) {
      await pool.query(
        `UPDATE cln_clientdetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [accountJson, cr.clientdetail_id]
      );
    }
    const crm = buildCrmFromInput({ ...m, permissions: ['clients'] });
    const hasCrm = await databaseHasColumn(pool, 'cln_client_operator', 'crm_json');
    if (hasCrm) {
      await pool.query(`UPDATE cln_client_operator SET crm_json = ? WHERE id = ?`, [JSON.stringify(crm), id]);
    }
    try {
      await pushClientAccounting(pool, getClnAccountProviderForOperator, effOpId, cr.clientdetail_id, {
        name: String(m.name || ''),
        email: emailNorm,
        phone: m.phone != null && String(m.phone).trim() !== '-' ? String(m.phone).trim() : '',
      });
    } catch (e) {
      console.warn('[cleanlemon] updateOperatorContactDomain client accounting', e?.message || e);
    }
    return;
  }

  const err = new Error('CONTACT_NOT_FOUND');
  err.code = 'CONTACT_NOT_FOUND';
  throw err;
}

async function deleteOperatorContactDomain(pool, junctionId, deleteDraftAgreementsForEmail) {
  const id = String(junctionId);
  const er = await getEmployeeJunctionRow(pool, id);
  if (er) {
    const em = String(er.email || '')
      .trim()
      .toLowerCase();
    const oid = er.operator_id != null ? String(er.operator_id).trim() : '';
    if (em && oid && typeof deleteDraftAgreementsForEmail === 'function') {
      await deleteDraftAgreementsForEmail(oid, em);
    }
    await pool.query('DELETE FROM cln_employee_operator WHERE id = ? LIMIT 1', [id]);
    return true;
  }
  const cr = await getClientJunctionRow(pool, id);
  if (cr) {
    const em = String(cr.email || '')
      .trim()
      .toLowerCase();
    const oid = cr.operator_id != null ? String(cr.operator_id).trim() : '';
    if (em && oid && typeof deleteDraftAgreementsForEmail === 'function') {
      await deleteDraftAgreementsForEmail(oid, em);
    }
    const cdid = cr.clientdetail_id;
    await pool.query('DELETE FROM cln_client_operator WHERE id = ? LIMIT 1', [id]);
    const [left] = await pool.query(
      'SELECT COUNT(*) AS n FROM cln_client_operator WHERE clientdetail_id = ?',
      [cdid]
    );
    if (Number(left[0]?.n || 0) === 0) {
      await pool.query('DELETE FROM cln_clientdetail WHERE id = ? LIMIT 1', [cdid]);
    }
    return true;
  }
  return false;
}

async function resolveAutomationContactMapRow(pool, operatorId, emailNorm) {
  const oid = String(operatorId || '').trim();
  const e = String(emailNorm || '')
    .trim()
    .toLowerCase();
  if (!oid || !e) return null;
  await ensureClnDomainContactExtras(pool);
  const [jrows] = await pool.query(
    `SELECT eo.id FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ?
     ORDER BY d.updated_at DESC LIMIT 1`,
    [oid, e]
  );
  const jid = jrows[0]?.id;
  if (!jid) return null;
  const er = await getEmployeeJunctionRow(pool, jid);
  if (er) {
    return mapEmployeeJunctionToContact(er, er, safeJson(er.crm_json, {}));
  }
  return null;
}

async function fetchStaffAgreementSnapshot(pool, operatorId, emailNorm) {
  const oid = String(operatorId || '').trim();
  const e = String(emailNorm || '')
    .trim()
    .toLowerCase();
  if (!oid || !e) return null;
  const [rows] = await pool.query(
    `SELECT d.full_name AS name, d.email, d.phone, eo.crm_json
     FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ?
     LIMIT 1`,
    [oid, e]
  );
  const er = rows[0];
  if (!er) return null;
  const crm = safeJson(er.crm_json, {});
  return {
    name: er.name,
    email: er.email,
    phone: er.phone,
    salary_basic: Number(crm.salaryBasic) || 0,
    joined_at: crm.joinedAt || null,
  };
}

async function listStaffEmailsForOperatorDomain(pool, operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT LOWER(TRIM(d.email)) AS email
       FROM cln_employee_operator eo
       INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
       WHERE eo.operator_id = ? AND TRIM(d.email) <> ''`,
      [oid]
    );
    return rows.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  ensureClnDomainContactExtras,
  clnDomainContactSchemaReady,
  loadEmployeeContactsForOperator,
  loadClientContactsForOperator,
  createOperatorContactDomain,
  updateOperatorContactDomain,
  deleteOperatorContactDomain,
  assertDomainEmailUnique,
  resolveAutomationContactMapRow,
  fetchStaffAgreementSnapshot,
  listStaffEmailsForOperatorDomain,
  mapEmployeeJunctionToContact,
  pushEmployeeAccounting,
  pushClientAccounting,
  mergeClientOperatorJunctionAccountingCrm,
  safeJson,
  crmStatusFromJson,
  databaseHasTable,
};
