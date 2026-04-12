#!/usr/bin/env node
/**
 * Migration: Replace id with wix_id, drop all *_wixid columns.
 *
 * 1) All tables: id = COALESCE(wix_id, id) (use Wix ID as primary key)
 * 2) Update all FK references in child tables
 * 3) Drop all wix_id, *_wixid columns
 *
 * Future import: Wix CMS export _id goes directly into id column.
 *
 * Run: node scripts/migrate-wixid-to-id.js [--dry-run]
 * Backup first: mysqldump -u ... -p dbname > backup.sql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  const db = process.env.DB_NAME;

  try {
    if (DRY_RUN) console.log('[DRY-RUN] Would execute the following:\n');

    // 1) Get all FK constraints
    const [fks] = await conn.query(`
      SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY REFERENCED_TABLE_NAME, TABLE_NAME
    `, [db]);

    // 2) Get all tables that have wix_id column (for id replacement)
    const [tablesWithWixId] = await conn.query(`
      SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'wix_id'
      ORDER BY TABLE_NAME
    `, [db]);

    // 3) Get all columns to drop (wix_id, *_wixid)
    const [colsToDrop] = await conn.query(`
      SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND (COLUMN_NAME = 'wix_id' OR COLUMN_NAME LIKE '%_wixid')
      ORDER BY TABLE_NAME, COLUMN_NAME
    `, [db]);

    const tablesToMigrate = tablesWithWixId.map(r => r.TABLE_NAME);
    console.log('Tables to migrate (id=wix_id):', tablesToMigrate.length, tablesToMigrate.join(', '));
    console.log('FKs to drop/re-add:', fks.length);
    console.log('Columns to drop:', colsToDrop.length);

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] Columns to drop per table:');
      const byTable = {};
      for (const r of colsToDrop) {
        (byTable[r.TABLE_NAME] = byTable[r.TABLE_NAME] || []).push(r.COLUMN_NAME);
      }
      for (const [t, cols] of Object.entries(byTable)) {
        console.log('  ', t, ':', cols.join(', '));
      }
      await conn.end();
      return;
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 4) Create migration mapping tables and temp id
    // id is varchar(36); CONCAT('_mig_', id) = 41 chars, so temporarily extend
    for (const table of tablesToMigrate) {
      const [hasWixId] = await conn.query(
        `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='wix_id'`,
        [db, table]
      );
      if (hasWixId.length === 0) continue;

      const migTable = `_mig_${table}`;
      await conn.query(`DROP TABLE IF EXISTS \`${migTable}\``);
      await conn.query(`
        CREATE TABLE \`${migTable}\` AS
        SELECT id AS old_id, COALESCE(NULLIF(TRIM(wix_id), ''), id) AS new_id
        FROM \`${table}\`
      `);
      await conn.query(`ALTER TABLE \`${table}\` MODIFY COLUMN id varchar(48) NOT NULL`);
      await conn.query(`UPDATE \`${table}\` SET id = CONCAT('_mig_', id)`);
      console.log('[ok] temp id', table);
    }

    // 5) Update child FK columns to new parent ids
    for (const fk of fks) {
      const { TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME } = fk;
      const migTable = `_mig_${REFERENCED_TABLE_NAME}`;
      if (!tablesToMigrate.includes(REFERENCED_TABLE_NAME)) continue;

      const [updated] = await conn.query(`
        UPDATE \`${TABLE_NAME}\` c
        INNER JOIN \`${migTable}\` m ON c.\`${COLUMN_NAME}\` = m.old_id
        SET c.\`${COLUMN_NAME}\` = m.new_id
      `);
      if (updated.affectedRows > 0) {
        console.log('[ok] FK update', TABLE_NAME + '.' + COLUMN_NAME, '->', REFERENCED_TABLE_NAME, '(', updated.affectedRows, 'rows)');
      }
    }

    // 6) Update each table id from temp to new_id, then restore varchar(36)
    for (const table of tablesToMigrate) {
      const migTable = `_mig_${table}`;
      await conn.query(`
        UPDATE \`${table}\` t
        INNER JOIN \`${migTable}\` m ON t.id = CONCAT('_mig_', m.old_id)
        SET t.id = m.new_id
      `);
      await conn.query(`ALTER TABLE \`${table}\` MODIFY COLUMN id varchar(36) NOT NULL`);
      console.log('[ok] id=wix_id', table);
    }

    // 7) Drop migration tables
    for (const table of tablesToMigrate) {
      await conn.query(`DROP TABLE IF EXISTS \`_mig_${table}\``);
    }

    // 8) Drop all wix_id and *_wixid columns
    const byTable = {};
    for (const r of colsToDrop) {
      (byTable[r.TABLE_NAME] = byTable[r.TABLE_NAME] || []).push(r.COLUMN_NAME);
    }
    for (const [table, columns] of Object.entries(byTable)) {
      for (const col of columns) {
        try {
          await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
          console.log('[ok] drop', table + '.' + col);
        } catch (e) {
          if (e.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
            console.warn('[skip]', table + '.' + col, '- column may not exist:', e.message);
          } else {
            throw e;
          }
        }
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\nMigration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
