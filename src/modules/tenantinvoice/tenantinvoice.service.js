/**
 * Tenant Invoice (Client Invoice) – list/create/update/delete rental records, filters, meter groups.
 * Uses MySQL: rentalcollection, propertydetail, roomdetail, tenantdetail, account (type), ownerdetail,
 * tenancy, meterdetail (metersharing_json). All FK by _id.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getAccessContextByEmail } = require('../access/access.service');
const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');
const {
  createInvoicesForRentalRecords,
  createReceiptForPaidRentalCollection
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');

/**
 * Get property list for filter dropdown. Returns { id, shortname }.
 */
async function getProperties(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  return rows.map((r) => ({ id: r.id, _id: r.id, shortname: r.shortname }));
}

/**
 * Get account (bukkuid) list for type dropdown. Returns { id, title }.
 */
async function getTypes(clientId) {
  const [rows] = await pool.query(
    'SELECT id, title FROM account ORDER BY title ASC LIMIT 1000'
  );
  return rows.map((r) => ({ id: r.id, _id: r.id, title: r.title }));
}

/**
 * Get rental list with filters. Includes property (shortname, ownername), room (title_fld), tenant (fullname), type (title).
 * Filters: property, type, from, to. Search/sort done in-memory after fetch (limit 1000).
 * Returns array of items in shape expected by frontend repeater (property, room, tenant, type as nested objects).
 */
async function getRentalList(clientId, opts = {}) {
  if (!clientId) return [];
  const { property, type, from, to } = opts;
  let sql = `
    SELECT r.id, r.invoiceid, r.paidat, r.referenceid, r.description, r.amount, r.ispaid, r.date, r.receipturl, r.invoiceurl, r.title,
           r.property_id, r.room_id, r.tenant_id, r.type_id,
           p.shortname AS property_shortname,
           o.ownername AS owner_ownername,
           rm.title_fld AS room_title_fld,
           t.fullname AS tenant_fullname,
           a.title AS type_title
    FROM rentalcollection r
    LEFT JOIN propertydetail p ON p.id = r.property_id
    LEFT JOIN ownerdetail o ON o.id = p.owner_id
    LEFT JOIN roomdetail rm ON rm.id = r.room_id
    LEFT JOIN tenantdetail t ON t.id = r.tenant_id
    LEFT JOIN account a ON a.id = r.type_id
    WHERE r.client_id = ?
  `;
  const params = [clientId];
  if (property && property !== 'ALL') {
    sql += ' AND r.property_id = ?';
    params.push(property);
  }
  if (type && type !== 'ALL') {
    sql += ' AND r.type_id = ?';
    params.push(type);
  }
  if (from) {
    sql += ' AND r.date >= ?';
    params.push(from instanceof Date ? from : new Date(from));
  }
  if (to) {
    sql += ' AND r.date <= ?';
    params.push(to instanceof Date ? to : new Date(to));
  }
  sql += ' ORDER BY r.date DESC LIMIT 1000';
  const [rows] = await pool.query(sql, params);
  return rows.map((row) => ({
    _id: row.id,
    id: row.id,
    invoiceid: row.invoiceid,
    paidat: row.paidat,
    referenceid: row.referenceid,
    description: row.description != null ? row.description : '',
    amount: row.amount,
    isPaid: !!row.ispaid,
    date: row.date,
    receipturl: row.receipturl,
    invoiceurl: row.invoiceurl,
    title: row.title,
    property: row.property_id
      ? { id: row.property_id, shortname: row.property_shortname, ownername: { ownerName: row.owner_ownername || '' } }
      : null,
    room: row.room_id ? { id: row.room_id, title_fld: row.room_title_fld } : null,
    tenant: row.tenant_id ? { id: row.tenant_id, fullname: row.tenant_fullname } : null,
    type: row.type_id ? { id: row.type_id, title: row.type_title } : null
  }));
}

/**
 * Get tenancy list (status = 1) with room and tenant for create-invoice dropdown.
 */
async function getTenancyList(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    `SELECT t.id, t.room_id, t.tenant_id,
            r.title_fld AS room_title_fld,
            tn.fullname AS tenant_fullname
     FROM tenancy t
     LEFT JOIN roomdetail r ON r.id = t.room_id
     LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
     WHERE t.client_id = ? AND t.status = 1
     ORDER BY t.id LIMIT 1000`,
    [clientId]
  );
  return rows.map((r) => ({
    id: r.id,
    _id: r.id,
    room: r.room_id ? { id: r.room_id, title_fld: r.room_title_fld } : null,
    tenant: r.tenant_id ? { id: r.tenant_id, fullname: r.tenant_fullname } : null
  }));
}

/**
 * Get meter groups from meterdetail where metersharing_json is not empty.
 * Returns array of { _id, groupId, name, meters: [{ _id, meterId, title, mode, rate, role, active, sharingmode, sharingType }] }.
 */
async function getMeterGroups(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    'SELECT id, meterid, title, mode, rate, metersharing_json FROM meterdetail WHERE client_id = ? AND metersharing_json IS NOT NULL AND JSON_LENGTH(COALESCE(metersharing_json, JSON_ARRAY())) > 0 LIMIT 500',
    [clientId]
  );
  const groupMap = new Map();
  for (const m of rows) {
    let arr = [];
    try {
      arr = typeof m.metersharing_json === 'string' ? JSON.parse(m.metersharing_json) : m.metersharing_json;
    } catch (_) {}
    if (!Array.isArray(arr)) continue;
    for (const ms of arr) {
      const gid = ms.sharinggroupId || ms.sharingGroupId;
      if (!gid) continue;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          _id: gid,
          groupId: gid,
          name: ms.groupName || `Group ${gid}`,
          meters: []
        });
      }
      groupMap.get(gid).meters.push({
        _id: m.id,
        meterId: m.meterid,
        title: m.title,
        mode: m.mode,
        rate: m.rate,
        role: ms.role || 'peer',
        active: ms.active !== false,
        sharingmode: ms.sharingmode,
        sharingType: ms.sharingType
      });
    }
  }
  return [...groupMap.values()];
}

/**
 * Insert rental records. Each record: { date, tenancy, type, amount, referenceid?, description? }.
 * tenancy = tenancy.id; type = account.id. Resolves room_id, tenant_id, property_id from tenancy.
 * referenceid and description are separate columns.
 */
async function insertRentalRecords(clientId, records) {
  if (!clientId || !Array.isArray(records) || records.length === 0) {
    return { ok: true, inserted: 0 };
  }
  const inserted = [];
  for (const rec of records.slice(0, 100)) {
    const tenancyId = rec.tenancy || rec.tenancy_id;
    const typeId = rec.type || rec.type_id;
    const amount = Number(rec.amount);
    const dateVal = rec.date ? (rec.date instanceof Date ? rec.date : new Date(rec.date)) : new Date();
    const title = rec.title || 'Manual entry';
    const referenceid = rec.referenceid != null ? String(rec.referenceid) : '';
    const description = rec.description != null ? String(rec.description) : '';

    const [tenancyRows] = await pool.query(
      'SELECT id, tenant_id, room_id, client_id FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
      [tenancyId, clientId]
    );
    if (!tenancyRows.length) continue;
    const tenancy = tenancyRows[0];
    const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
    const propertyId = roomRows[0] ? roomRows[0].property_id : null;

    const id = randomUUID();
    const dateStr = dateVal.toISOString().replace('T', ' ').substring(0, 19);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await pool.query(
      `INSERT INTO rentalcollection (id, client_id, property_id, room_id, tenant_id, type_id, amount, date, title, referenceid, description, ispaid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, clientId, propertyId, tenancy.room_id, tenancy.tenant_id, typeId, amount, dateStr, title, referenceid, description, now, now]
    );
    inserted.push({
      id,
      client_id: clientId,
      property_id: propertyId,
      tenant_id: tenancy.tenant_id,
      type_id: typeId,
      amount,
      date: dateStr,
      title,
      tenancy_id: tenancyId,
      room_id: tenancy.room_id
    });
  }
  if (inserted.length) {
    try {
      await createInvoicesForRentalRecords(clientId, inserted);
    } catch (e) {
      console.warn('createInvoicesForRentalRecords (tenantinvoice insert) failed:', e?.message || e);
    }
  }
  return { ok: true, inserted: inserted.length, ids: inserted.map((r) => r.id) };
}

/**
 * Delete rental records by ids. Only rows with client_id = clientId.
 */
async function deleteRentalRecords(clientId, ids) {
  if (!clientId || !Array.isArray(ids) || ids.length === 0) {
    return { ok: true, deleted: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await pool.query(
    `DELETE FROM rentalcollection WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...ids]
  );
  return { ok: true, deleted: result.affectedRows || 0 };
}

/**
 * Update one rental record (e.g. mark paid). Only rows with client_id = clientId.
 */
async function updateRentalRecord(clientId, id, payload) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_ID' };
  const updates = [];
  const params = [];
  const willMarkPaid = payload.isPaid === true;
  if (payload.isPaid !== undefined) {
    updates.push('ispaid = ?');
    params.push(payload.isPaid ? 1 : 0);
  }
  if (payload.paidAt !== undefined) {
    updates.push('paidat = ?');
    params.push(payload.paidAt instanceof Date ? payload.paidAt : new Date(payload.paidAt));
  }
  if (payload.referenceid !== undefined) {
    updates.push('referenceid = ?');
    params.push(payload.referenceid);
  }
  if (payload.description !== undefined) {
    updates.push('description = ?');
    params.push(payload.description);
  }
  if (updates.length === 0) return { ok: true };
  params.push(id, clientId);
  const [result] = await pool.query(
    `UPDATE rentalcollection SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    params
  );
  const updated = result.affectedRows || 0;
  if (updated > 0 && willMarkPaid) {
    try {
      await createReceiptForPaidRentalCollection([id], {
        source: 'manual',
        method: payload.paymentMethod || null
      });
    } catch (err) {
      console.warn('[tenantinvoice] createReceiptForPaidRentalCollection failed', err?.message || err);
    }
  }
  return { ok: true, updated };
}

/**
 * Meter invoice calculation – usage phase and calculation phase (port from Wix backend/query/metercalculation).
 */
function fmtDate(d) {
  if (d == null || (typeof d !== 'string' && typeof d !== 'number' && !(d instanceof Date))) {
    return 'Invalid date';
  }
  const date = d instanceof Date ? d : new Date(d);
  const ts = typeof date.getTime === 'function' ? date.getTime() : NaN;
  if (typeof ts !== 'number' || Number.isNaN(ts)) return 'Invalid date';
  const adjusted = new Date(ts + 8 * 60 * 60 * 1000);
  const day = adjusted.getUTCDate();
  const month = adjusted.getUTCMonth();
  const year = adjusted.getUTCFullYear();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${monthNames[month]} ${year}`;
}

async function handleUsagePhase(clientId, { groupMeters, period }) {
  if (!period || (period.start == null && period.end == null)) {
    throw new Error('Missing period.start and period.end for meter calculation');
  }
  const parent = groupMeters.find((m) => m.role === 'parent');
  const peers = groupMeters.filter((m) => m.role === 'peer');
  const children = groupMeters.filter((m) => m.role === 'child');
  const isBrotherGroup =
    !parent && peers.length > 0 && groupMeters[0]?.sharingmode === 'brother';

  const usageSummary = await meterWrapper.getUsageSummary(clientId, {
    meterIds: groupMeters.map((m) => m.meterId),
    start: period.start,
    end: period.end
  });
  const usageMap = {};
  groupMeters.forEach((m) => {
    usageMap[m.meterId] = Number(usageSummary?.children?.[m.meterId] || 0);
  });

  if (isBrotherGroup) {
    let totalUsage = 0;
    let textdetail = `Period: ${fmtDate(period.start)} → ${fmtDate(period.end)}\n--------------------------------\nGroup type: Brother (peer)\nMeters: ${groupMeters.length}\n\nUsage breakdown:\n`;
    groupMeters.forEach((m) => {
      const u = usageMap[m.meterId] || 0;
      totalUsage += u;
      textdetail += `\n${m.title || m.meterId}\nUsage: ${u.toFixed(2)} kWh\nRate: ${m.rate ?? '-'}\nActive: ${m.active !== false}\n`;
    });
    return {
      ok: true,
      phase: 'usage',
      usageSnapshot: {
        start: period.start,
        end: period.end,
        sharingmode: 'brother',
        totalUsage,
        usageMap
      },
      textdetail: textdetail.trim(),
      totalText: `Total usage: ${totalUsage.toFixed(2)} kWh`
    };
  }

  if (!parent) {
    throw new Error('Invalid meter group: parent not found');
  }
  const parentUsage = usageMap[parent.meterId] || 0;
  const activeChildren = children.filter((c) => c.active !== false);
  let childrenUsageSum = 0;
  activeChildren.forEach((c) => {
    childrenUsageSum += usageMap[c.meterId] || 0;
  });
  const sharedUsage =
    parent.sharingmode === 'parent_manual'
      ? parentUsage
      : Math.max(parentUsage - childrenUsageSum, 0);
  let textdetail = `Period: ${fmtDate(period.start)} → ${fmtDate(period.end)}\n--------------------------------\nParent usage: ${parentUsage.toFixed(2)} kWh\nChildren usage sum: ${childrenUsageSum.toFixed(2)} kWh\n\nChild breakdown:\n`;
  activeChildren.forEach((c) => {
    textdetail += `\n${c.title || c.meterId}\nUsage: ${(usageMap[c.meterId] || 0).toFixed(2)} kWh\n`;
  });
  return {
    ok: true,
    phase: 'usage',
    usageSnapshot: {
      start: period.start,
      end: period.end,
      sharingmode: parent.sharingmode,
      parentUsage,
      sharedUsage,
      totalUsage: sharedUsage,
      usageMap
    },
    textdetail: textdetail.trim(),
    totalText: `Shared usage: ${sharedUsage.toFixed(2)} kWh`
  };
}

/**
 * Supported sharingType: percentage | divide_equally | room only (tenancy removed per docs/meter-billing-spec.md).
 */
function handleCalculationPhase({ groupMeters, usageSnapshot, inputAmount, sharingType }) {
  const children = groupMeters.filter((m) => m.role !== 'parent');
  const activeChildren = children.filter((c) => c.active !== false);
  const usageMap = usageSnapshot.usageMap || {};
  let textcalculation = '';
  let formulaText = '';
  const totalText = `Total bill amount: ${Math.round(inputAmount)}`;

  if (sharingType === 'divide_equally') {
    const count = activeChildren.length;
    const eachAmount = count > 0 ? Math.round(inputAmount / count) : 0;
    formulaText = `${Math.round(inputAmount)} ÷ ${count} meter(s)`;
    activeChildren.forEach((c) => {
      textcalculation += `\n${c.title || c.meterId}\nAmount: ${eachAmount}\n`;
    });
  } else if (sharingType === 'percentage') {
    let totalUsage = 0;
    activeChildren.forEach((c) => {
      totalUsage += Number(usageMap[c.meterId] || 0);
    });
    activeChildren.forEach((c) => {
      const usage = Number(usageMap[c.meterId] || 0);
      const ratio = totalUsage > 0 ? usage / totalUsage : 0;
      const amount = Math.round(ratio * inputAmount);
      textcalculation += `\n${c.title || c.meterId}\nUsage ratio: ${(ratio * 100).toFixed(2)}%\nAmount: ${amount}\n`;
      formulaText += `${usage.toFixed(2)} ÷ ${totalUsage.toFixed(2)}\n`;
    });
  } else if (sharingType === 'room') {
    const count = activeChildren.length;
    const eachAmount = count > 0 ? Math.round(inputAmount / count) : 0;
    formulaText = `${Math.round(inputAmount)} ÷ ${count} meter(s)`;
    activeChildren.forEach((c) => {
      textcalculation += `\n${c.title || c.meterId}\nAmount: ${eachAmount}\n`;
    });
  }

  return {
    ok: true,
    phase: 'calculation',
    textcalculation: textcalculation.trim(),
    formulaText: formulaText.trim(),
    totalText
  };
}

async function calculateMeterInvoice(email, params) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT');

  if (params.mode === 'usage') {
    return handleUsagePhase(clientId, params);
  }
  if (params.mode === 'calculation') {
    return handleCalculationPhase(params);
  }
  throw new Error('Unknown calculation mode');
}

module.exports = {
  getProperties,
  getTypes,
  getRentalList,
  getTenancyList,
  getMeterGroups,
  insertRentalRecords,
  deleteRentalRecords,
  updateRentalRecord,
  calculateMeterInvoice
};
