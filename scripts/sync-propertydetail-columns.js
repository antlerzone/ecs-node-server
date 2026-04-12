/**
 * 给 propertydetail 表补新列（wix_id, client_id, client_wixid, meter_id 等），
 * 并从旧列拷贝：wixid -> wix_id, client -> client_wixid，并解析 client_id。
 * 不删旧列，避免丢数据。用法：node scripts/sync-propertydetail-columns.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const TABLE = 'propertydetail';

const NEW_COLUMNS = [
  { name: 'wix_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'client_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'client_wixid', def: 'varchar(36) DEFAULT NULL' },
  { name: 'meter_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'saj', def: 'varchar(255) DEFAULT NULL' },
  { name: 'signature', def: 'text' },
  { name: 'tenancyenddate', def: 'datetime DEFAULT NULL' },
  { name: 'management_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'internettype_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'tnb', def: 'decimal(18,2) DEFAULT NULL' },
  { name: 'electricid', def: 'varchar(100) DEFAULT NULL' },
  { name: 'owner_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'agreementtemplate_id', def: 'varchar(36) DEFAULT NULL' },
  { name: 'created_at', def: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP' },
  { name: 'updated_at', def: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
];

async function getExistingColumns(conn) {
  const [rows] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
    [process.env.DB_NAME, TABLE]
  );
  return new Set(rows.map(r => (r.column_name || r.COLUMN_NAME || '').toLowerCase()));
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const existing = await getExistingColumns(conn);

    for (const col of NEW_COLUMNS) {
      if (existing.has(col.name.toLowerCase())) continue;
      await conn.query(
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col.name}\` ${col.def}`
      );
      console.log('[sync-propertydetail] Added column', col.name);
    }

    const hasWixid = existing.has('wixid');
    const hasClient = existing.has('client');
    const hasWixId = existing.has('wix_id');
    const hasClientWixid = existing.has('client_wixid');
    const hasClientId = existing.has('client_id');

    if (hasWixid && hasWixId) {
      await conn.query(
        `UPDATE \`${TABLE}\` SET wix_id = wixid WHERE wix_id IS NULL AND wixid IS NOT NULL`
      );
      console.log('[sync-propertydetail] Backfilled wix_id from wixid');
    }
    if (hasClient && hasClientWixid) {
      await conn.query(
        `UPDATE \`${TABLE}\` SET client_wixid = client WHERE client_wixid IS NULL AND client IS NOT NULL`
      );
      console.log('[sync-propertydetail] Backfilled client_wixid from client');
    }
    if (hasClientId && hasClientWixid) {
      const [rows] = await conn.query(
        `SELECT id, wix_id FROM operatordetail WHERE wix_id IS NOT NULL`
      );
      const wixToId = new Map(rows.map(r => [r.wix_id, r.id]));
      const [pdRows] = await conn.query(
        `SELECT id, client_wixid FROM \`${TABLE}\` WHERE client_id IS NULL AND client_wixid IS NOT NULL`
      );
      for (const r of pdRows) {
        const cid = wixToId.get(r.client_wixid) || null;
        if (cid) await conn.query(`UPDATE \`${TABLE}\` SET client_id = ? WHERE id = ?`, [cid, r.id]);
      }
      console.log('[sync-propertydetail] Resolved client_id from client_wixid for', pdRows.length, 'rows');
    }

    const idxCols = ['idx_propertydetail_wix_id', 'idx_propertydetail_client_id', 'idx_propertydetail_client_wixid'];
    for (const idx of idxCols) {
      const col = idx.replace('idx_propertydetail_', '');
      try {
        await conn.query(`ALTER TABLE \`${TABLE}\` ADD KEY ${idx} (${col})`);
        console.log('[sync-propertydetail] Added index', idx);
      } catch (e) {
        if (!e.message.includes('Duplicate')) console.warn('[sync-propertydetail] Index', idx, e.message);
      }
    }

    console.log('[sync-propertydetail] Done.');
  } catch (err) {
    console.error('[sync-propertydetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
