/**
 * Run a single migration SQL file. Without arg: runs 0001_init.sql only.
 * To run e.g. owner_property (fix "Table owner_property doesn't exist"):
 *   node scripts/run-migration.js src/db/migrations/0037_owner_client_owner_property_junction.sql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const migrationArg = process.argv[2];
const sqlPath = migrationArg
  ? path.isAbsolute(migrationArg) ? migrationArg : path.join(process.cwd(), migrationArg)
  : path.join(__dirname, '..', 'src', 'db', 'migrations', '0001_init.sql');

// 从 CREATE TABLE 语句里解析出列名（仅字段行，不含 PRIMARY KEY / KEY / CONSTRAINT）
function parseColumnNames(createSql) {
  const match = createSql.match(/\(\s*([\s\S]*?)\s*\)\s*ENGINE=/);
  if (!match) return [];
  const body = match[1];
  const skipStarts = ['PRIMARY KEY', 'KEY ', 'CONSTRAINT ', 'UNIQUE ', 'FOREIGN KEY', 'CHECK ', 'ON ', 'REFERENCES '];
  const skipWords = new Set(['on', 'references', 'cascade', 'restrict', 'update', 'delete', 'set', 'null']);
  const names = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith(')')) continue;
    const isSkip = skipStarts.some(s => t.startsWith(s));
    if (isSkip) continue;
    const first = t.split(/\s+/)[0];
    const colName = first ? String(first).replace(/^`|`$/g, '').toLowerCase() : '';
    if (colName && !skipWords.has(colName)) names.push(colName);
  }
  return names;
}

// 把 SQL 按 CREATE TABLE 拆成多段，保留顺序
function splitCreateStatements(fullSql) {
  const out = [];
  let rest = fullSql;
  const setMatch = rest.match(/^[\s\S]*?SET NAMES[\s\S]*?;/);
  if (setMatch) {
    out.push({ type: 'set', sql: setMatch[0].trim() });
    rest = rest.slice(setMatch[0].length);
  }
  const createRegex = /CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(/gi;
  let m;
  let lastEnd = 0;
  const creates = [];
  while ((m = createRegex.exec(rest)) !== null) {
    const name = (m[1] || '').trim();
    if (name) creates.push({ name: name.toLowerCase(), start: m.index });
  }
  for (let i = 0; i < creates.length; i++) {
    const start = creates[i].start;
    const end = i + 1 < creates.length ? creates[i + 1].start : rest.length;
    let block = rest.slice(start, end);
    const close = block.lastIndexOf(');');
    if (close !== -1) block = block.slice(0, close + 2);
    out.push({ type: 'create', table: creates[i].name, sql: block.trim() });
  }
  return out;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: false,
    charset: 'utf8mb4'
  });

  const dbName = process.env.DB_NAME;

  try {
    const fullSql = fs.readFileSync(sqlPath, 'utf8');
    const is0001 = !migrationArg || sqlPath.replace(/\\/g, '/').endsWith('0001_init.sql');

    if (!is0001) {
      const connMulti = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        charset: 'utf8mb4'
      });
      const rawParts = fullSql.split(';').map(s => s.trim()).filter(Boolean);
      const stripCommentLines = (sql) =>
        sql
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
      const parts = rawParts
        .map(stripCommentLines)
        .filter((p) => p.length > 0 && /^(CREATE|INSERT|ALTER|SET|UPDATE|DELETE|DROP)\s/i.test(p));
      for (const part of parts) {
        if (part.toUpperCase().startsWith('SET ')) {
          await connMulti.query(part + ';');
          continue;
        }
        try {
          await connMulti.query(part + ';');
        } catch (e) {
          if (e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060) {
            console.log('[skip] duplicate column:', part.slice(0, 60) + '...');
            continue;
          }
          throw e;
        }
        const createMatch = part.match(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i);
        if (createMatch) console.log('[ok]', createMatch[1].toLowerCase());
      }
      console.log('Migration', path.basename(sqlPath), 'finished.');
      await connMulti.end();
      return;
    }

    const statements = splitCreateStatements(fullSql);

    for (const st of statements) {
      if (st.type === 'set') {
        await conn.query(st.sql);
        continue;
      }
      if (st.type !== 'create') continue;
      const tableName = st.table && String(st.table).toLowerCase();
      if (!tableName) continue;

      const [rows] = await conn.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [dbName, tableName]
      );
      const exists = rows.length > 0;

      if (exists) {
        try {
          await conn.query(`ALTER TABLE \`${tableName}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        } catch (e) {
          if (!e.message.includes('Unknown collation')) console.warn(`[warn] alter ${tableName}:`, e.message);
        }
      }

      if (exists) {
        const [cols] = await conn.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
          [dbName, tableName]
        );
        const actualNames = new Set(cols.map(c => String(c.column_name || c.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
        const expectedNames = new Set(parseColumnNames(st.sql));
        const missing = [...expectedNames].filter(n => !actualNames.has(n));
        const extra = [...actualNames].filter(n => !expectedNames.has(n));
        if (missing.length === 0 && extra.length === 0) {
          console.log(`[skip] ${tableName} (table exists, columns match)`);
          continue;
        }
        if (missing.length > 0 || extra.length > 0) {
          console.warn(`[skip] ${tableName} (table exists but columns differ: missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'})`);
          continue;
        }
      }

      try {
        await conn.query(st.sql);
        console.log(`[ok] ${tableName}`);
      } catch (createErr) {
        const msg = createErr.message || '';
        const skipPatterns = [
          'incompatible',
          'foreign key',
          'Foreign key',
          'Failed to open the referenced table',
          'Cannot add foreign key constraint'
        ];
        if (skipPatterns.some(p => msg.includes(p))) {
          console.warn(`[skip] ${tableName} (create failed: ${msg.slice(0, 80)}...)`);
        } else {
          throw createErr;
        }
      }
    }

    console.log('Migration 0001_init.sql finished.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
