/**
 * 按 client id (UUID) 删除该 client 及其在所有关联表的数据。
 * - 从 information_schema 动态读取所有含 client_id 的表，避免漏表。
 * - 先删仅通过 tenancy / property / tenant 关联、表本身无 client_id 的数据（如 metertransaction、doorsync）。
 *
 * Usage: node scripts/delete-client-by-id.js <client_id> [--orphans-only]
 * Example: node scripts/delete-client-by-id.js 9c441772-076d-42d5-a8a7-f70ec36952d0
 *
 * --orphans-only：仅清理「无 client_id 列或 client_id 为空」但仍引用该 UUID 的残留
 *（如 tenancy.title/billsurl 内嵌 UUID、ownerdetail.account JSON 里的 accounting contact）。
 * 在 operatordetail 已删后仍可再跑一次。
 *
 * Requires: .env 中有 DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const args = process.argv.slice(2).filter((a) => a !== '--orphans-only');
const ORPHANS_ONLY = process.argv.includes('--orphans-only');
const CLIENT_ID = args[0] && args[0].trim();
if (!CLIENT_ID) {
  console.error('Usage: node scripts/delete-client-by-id.js <client_id> [--orphans-only]');
  process.exit(1);
}

async function fetchTablesWithClientId(conn) {
  const [rows] = await conn.query(
    `
    SELECT TABLE_NAME AS name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME = 'client_id'
    ORDER BY TABLE_NAME
    `
  );
  return rows.map((r) => r.name);
}

/**
 * 这些表没有 client_id，但通过 tenancy / property / tenant 属于该 client；需在删 tenancy 等之前清理。
 */
const SCOPED_DELETES = [
  {
    label: 'doorsync (by tenancy)',
    sql:
      'DELETE FROM `doorsync` WHERE tenancy_id IN (SELECT id FROM `tenancy` WHERE client_id = ?)',
  },
  {
    label: 'metertransaction (by tenancy)',
    sql:
      'DELETE FROM `metertransaction` WHERE tenancy_id IN (SELECT id FROM `tenancy` WHERE client_id = ?)',
  },
  {
    label: 'metertransaction (by property)',
    sql:
      'DELETE FROM `metertransaction` WHERE property_id IN (SELECT id FROM `propertydetail` WHERE client_id = ?)',
  },
  {
    label: 'metertransaction (by tenant)',
    sql:
      'DELETE FROM `metertransaction` WHERE tenant_id IN (SELECT id FROM `tenantdetail` WHERE client_id = ?)',
  },
  {
    label: 'owner_property (by property)',
    sql:
      'DELETE FROM `owner_property` WHERE property_id IN (SELECT id FROM `propertydetail` WHERE client_id = ?)',
  },
  {
    label: 'property_supplier_extra (by property)',
    sql:
      'DELETE FROM `property_supplier_extra` WHERE property_id IN (SELECT id FROM `propertydetail` WHERE client_id = ?)',
  },
];

async function runOptionalDelete(conn, { label, sql }, clientId) {
  try {
    const [r] = await conn.query(sql, [clientId]);
    if (r.affectedRows > 0) {
      console.log('  Deleted', r.affectedRows, 'rows —', label);
    }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw e;
  }
}

/** [{ clientId, provider, id }] — 去掉指定 clientId 的条目 */
function filterAccountJsonArray(text, clientId) {
  if (!text || typeof text !== 'string') {
    return { changed: false, next: text };
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) {
    return { changed: false, next: text };
  }
  let arr;
  try {
    arr = JSON.parse(trimmed);
  } catch {
    return { changed: false, next: text };
  }
  if (!Array.isArray(arr)) {
    return { changed: false, next: text };
  }
  const next = arr.filter((x) => x && String(x.clientId) !== clientId);
  if (next.length === arr.length) {
    return { changed: false, next: text };
  }
  return { changed: true, next: JSON.stringify(next) };
}

/**
 * 无 client_id / client_id 为 NULL 但仍出现该 UUID 的残留：
 * - tenancy：历史文本写在 title，或 billsurl 存了 client UUID（删 client 时 WHERE client_id 扫不到）
 * - ownerdetail/staffdetail/tenantdetail/supplierdetail：account JSON 里的 Bukku contact 映射
 */
async function cleanupOrphanReferences(conn, clientId) {
  const like = `%${clientId}%`;
  try {
    const [r] = await conn.query(
      'DELETE FROM `tenancy` WHERE `billsurl` = ? OR `billsurl` LIKE ? OR `title` LIKE ?',
      [clientId, like, like]
    );
    if (r.affectedRows > 0) {
      console.log('  Deleted', r.affectedRows, 'rows — tenancy (title/billsurl 引用 UUID)');
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      throw e;
    }
  }

  const [acctTables] = await conn.query(
    `
    SELECT TABLE_NAME AS name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME = 'account'
    ORDER BY TABLE_NAME
    `
  );
  for (const { name: table } of acctTables) {
    try {
      const [hasUa] = await conn.query(
        `
        SELECT 1 AS ok
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'updated_at'
        LIMIT 1
        `,
        [table]
      );
      const useUpdatedAt = hasUa.length > 0;
      const [rows] = await conn.query(
        `SELECT id, account FROM \`${table}\` WHERE account LIKE ?`,
        [like]
      );
      for (const row of rows) {
        const { changed, next } = filterAccountJsonArray(row.account, clientId);
        if (!changed) {
          continue;
        }
        if (useUpdatedAt) {
          await conn.query(
            `UPDATE \`${table}\` SET account = ?, updated_at = NOW() WHERE id = ?`,
            [next, row.id]
          );
        } else {
          await conn.query(`UPDATE \`${table}\` SET account = ? WHERE id = ?`, [next, row.id]);
        }
        console.log('  Stripped account JSON —', table, row.id);
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') {
        throw e;
      }
    }
  }
}

async function deleteClientById(clientId, options = {}) {
  const { orphansOnly = false } = options;
  const conn = await pool.getConnection();
  try {
    if (orphansOnly) {
      console.log('Orphan cleanup only for:', clientId);
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      await cleanupOrphanReferences(conn, clientId);
      console.log('Done (orphans).');
      return;
    }

    const [exists] = await conn.query('SELECT id, title, email FROM operatordetail WHERE id = ?', [clientId]);
    if (!exists.length) {
      console.log('No client found with id:', clientId, '— run with --orphans-only to clean stray rows.');
      return;
    }
    const c = exists[0];
    console.log('Deleting client:', clientId, '(', c.title || '', c.email || '', ')');

    const tablesWithClientId = await fetchTablesWithClientId(conn);
    console.log('Tables with client_id:', tablesWithClientId.length);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const step of SCOPED_DELETES) {
      await runOptionalDelete(conn, step, clientId);
    }

    for (const table of tablesWithClientId) {
      try {
        const [r] = await conn.query(`DELETE FROM \`${table}\` WHERE client_id = ?`, [clientId]);
        if (r.affectedRows > 0) {
          console.log('  Deleted', r.affectedRows, 'rows from', table);
        }
      } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
          continue;
        }
        throw e;
      }
    }
    const [r] = await conn.query('DELETE FROM operatordetail WHERE id = ?', [clientId]);
    if (r.affectedRows > 0) {
      console.log('  Deleted operatordetail:', clientId);
    }

    await cleanupOrphanReferences(conn, clientId);
    console.log('Done.');
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    conn.release();
  }
}

async function main() {
  await deleteClientById(CLIENT_ID, { orphansOnly: ORPHANS_ONLY });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
