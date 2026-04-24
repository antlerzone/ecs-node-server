/**
 * 删除单个 Cleanlemons 运营商（cln_operatordetail）及其物业子树、所有指向该主表的 FK 行与常见无 FK 的 operator_id 列。
 *
 * 传入值可为：
 *   - cln_operatordetail.id（CHAR(36)）
 *   - cln_operator_subscription.id（如 cln-sub-...），脚本会解析出 operator_id
 *
 * 默认仅打印将要删除的行数（dry-run）。真正执行须加 --execute。
 *
 *   node scripts/wipe-cln-operatordetail.js cln-sub-857ac55a-3fa8-11f1-a4e2-00163e006722
 *   node scripts/wipe-cln-operatordetail.js <operatordetail-uuid> --execute
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const rawId = process.argv[2];
const execute = process.argv.includes('--execute');

if (!rawId || rawId.startsWith('-')) {
  console.error(
    'Usage: node scripts/wipe-cln-operatordetail.js <operatordetail-id-or-subscription-id> [--execute]'
  );
  process.exit(1);
}

async function fkColumns(conn, db, referencedTable) {
  const [rows] = await conn.query(
    `SELECT DISTINCT TABLE_NAME AS tbl, COLUMN_NAME AS col
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ?
       AND REFERENCED_TABLE_SCHEMA = ?
       AND REFERENCED_TABLE_NAME = ?
       AND TABLE_NAME IS NOT NULL
       AND COLUMN_NAME IS NOT NULL`,
    [db, db, referencedTable]
  );
  return rows;
}

async function deleteWhereIn(conn, tbl, col, ids, dry) {
  if (!ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  const sql = `DELETE FROM \`${tbl}\` WHERE \`${col}\` IN (${ph})`;
  if (dry) {
    const [c] = await conn.query(
      `SELECT COUNT(*) AS n FROM \`${tbl}\` WHERE \`${col}\` IN (${ph})`,
      ids
    );
    return Number(c[0].n);
  }
  const [r] = await conn.query(sql, ids);
  return r.affectedRows ?? 0;
}

async function deleteWhereEq(conn, tbl, col, id, dry) {
  const sql = `DELETE FROM \`${tbl}\` WHERE \`${col}\` = ?`;
  if (dry) {
    const [c] = await conn.query(`SELECT COUNT(*) AS n FROM \`${tbl}\` WHERE \`${col}\` = ?`, [id]);
    return Number(c[0].n);
  }
  const [r] = await conn.query(sql, [id]);
  return r.affectedRows ?? 0;
}

async function tableExists(conn, db, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1',
    [db, name]
  );
  return rows.length > 0;
}

async function columnExists(conn, db, table, col) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1',
    [db, table, col]
  );
  return rows.length > 0;
}

async function optionalDeleteEq(conn, db, table, col, opId, dry) {
  if (!(await tableExists(conn, db, table))) return 0;
  if (!(await columnExists(conn, db, table, col))) return 0;
  return deleteWhereEq(conn, table, col, opId, dry);
}

async function run() {
  const db = process.env.DB_NAME;
  if (!db) {
    console.error('Missing DB_NAME in .env');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    charset: 'utf8mb4',
    multipleStatements: false,
  });

  const dry = !execute;
  let total = 0;

  try {
    const [[master]] = await conn.query(
      'SELECT id AS id FROM `cln_operatordetail` WHERE id = ? LIMIT 1',
      [rawId]
    );
    let opId = master?.id || null;
    if (!opId) {
      const [[sub]] = await conn.query(
        'SELECT operator_id AS oid FROM `cln_operator_subscription` WHERE id = ? LIMIT 1',
        [rawId]
      );
      opId = sub?.oid || null;
    }
    if (!opId) {
      console.error('Not found: no cln_operatordetail.id and no cln_operator_subscription.id match:', rawId);
      process.exit(1);
    }

    console.log(dry ? 'DRY-RUN (no changes). Pass --execute to apply.' : 'EXECUTING deletes…');
    console.log('Resolved operator_id (cln_operatordetail.id):', opId);

    if (!dry) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    }

    // Subscription / pricing logs: some DBs may lack InnoDB FK metadata; remove explicitly first.
    for (const tbl of ['cln_operator_subscription_addon', 'cln_operator_subscription']) {
      if (await tableExists(conn, db, tbl)) {
        const n = await deleteWhereEq(conn, tbl, 'operator_id', opId, dry);
        if (n) console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from ${tbl} (operator_id)`);
        total += n;
      }
    }
    if (await tableExists(conn, db, 'cln_pricingplanlog')) {
      const n = await deleteWhereEq(conn, 'cln_pricingplanlog', 'operator_id', opId, dry);
      if (n) console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from cln_pricingplanlog`);
      total += n;
    }
    if (await tableExists(conn, db, 'cln_addonlog')) {
      const n = await deleteWhereEq(conn, 'cln_addonlog', 'operator_id', opId, dry);
      if (n) console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from cln_addonlog`);
      total += n;
    }

    const [propRows] = await conn.query(
      'SELECT id FROM `cln_property` WHERE operator_id = ?',
      [opId]
    );
    const propertyIds = propRows.map((r) => r.id);
    console.log('Properties for operator:', propertyIds.length);

    if (propertyIds.length) {
      const pc = await fkColumns(conn, db, 'cln_property');
      for (const { tbl, col } of pc) {
        const n = await deleteWhereIn(conn, tbl, col, propertyIds, dry);
        if (n) {
          console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from \`${tbl}\`.\`${col}\` (property FK)`);
          total += n;
        }
      }
      const np = await deleteWhereEq(conn, 'cln_property', 'operator_id', opId, dry);
      if (np) {
        console.log(`  ${dry ? '[would delete]' : 'deleted'} ${np} from cln_property (operator_id)`);
        total += np;
      }
    } else {
      const np = await deleteWhereEq(conn, 'cln_property', 'operator_id', opId, dry);
      if (np) {
        console.log(`  ${dry ? '[would delete]' : 'deleted'} ${np} from cln_property (operator_id)`);
        total += np;
      }
    }

    const oc = await fkColumns(conn, db, 'cln_operatordetail');
    for (const { tbl, col } of oc) {
      if (tbl === 'cln_operatordetail') continue;
      const n = await deleteWhereEq(conn, tbl, col, opId, dry);
      if (n) {
        console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from \`${tbl}\`.\`${col}\` (operatordetail FK)`);
        total += n;
      }
    }

    const extras = [
      ['lockdetail', 'cln_operatorid'],
      ['gatewaydetail', 'cln_operatorid'],
      ['cln_account_client', 'operator_id'],
      ['cln_salary_record', 'operator_id'],
      ['cln_operator_salary_settings', 'operator_id'],
      ['cln_b2b_invoice_checkout', 'operator_id'],
      ['cln_client_invoice', 'operator_id'],
      ['cln_client_payment', 'operator_id'],
      ['cln_operator_integration', 'operator_id'],
    ];
    for (const [tbl, col] of extras) {
      const n = await optionalDeleteEq(conn, db, tbl, col, opId, dry);
      if (n) {
        console.log(`  ${dry ? '[would delete]' : 'deleted'} ${n} from \`${tbl}\`.\`${col}\` (extra)`);
        total += n;
      }
    }

    const nOd = await deleteWhereEq(conn, 'cln_operatordetail', 'id', opId, dry);
    if (nOd) {
      console.log(`  ${dry ? '[would delete]' : 'deleted'} ${nOd} from cln_operatordetail`);
      total += nOd;
    }

    if (!dry) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    console.log(dry ? `Dry-run total row count (approx): ${total}` : `Done. Affected rows (sum): ${total}`);
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e?.sqlMessage || e?.message || e);
  process.exit(1);
});
