/**
 * 先清空表数据，再导入 CSV。
 * 用法：node scripts/clear-and-import.js <表名> [csv路径]
 * 表名：clientdetail | propertydetail | ownerdetail | tenantdetail
 * 默认 csv 路径：./<表名>.csv
 *
 * 例：node scripts/clear-and-import.js tenantdetail
 * 例：node scripts/clear-and-import.js tenantdetail ./tenantdetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawnSync } = require('child_process');
const path = require('path');

const table = process.argv[2];
const csvPath = process.argv[3] || path.join(process.cwd(), table + '.csv');

const ALLOWED = {
  clientdetail: { truncate: 'truncate-clientdetail.js', import: 'import-clientdetail.js' },
  propertydetail: { truncate: 'truncate-propertydetail.js', import: 'import-propertydetail.js' },
  ownerdetail: { truncate: 'truncate-ownerdetail.js', import: 'import-ownerdetail.js' },
  tenantdetail: { truncate: 'truncate-tenantdetail.js', import: 'import-tenantdetail.js' },
};

if (!table || !ALLOWED[table]) {
  console.error('Usage: node scripts/clear-and-import.js <table> [csv_path]');
  console.error('Table must be one of: clientdetail, propertydetail, ownerdetail, tenantdetail');
  process.exit(1);
}

const scriptsDir = path.join(__dirname);
const truncateScript = path.join(scriptsDir, ALLOWED[table].truncate);
const importScript = path.join(scriptsDir, ALLOWED[table].import);

console.log('[clear-and-import] 1) Truncate', table);
const t = spawnSync('node', [truncateScript], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
if (t.status !== 0) {
  console.error('[clear-and-import] Truncate failed.');
  process.exit(1);
}

console.log('[clear-and-import] 2) Import', csvPath);
const i = spawnSync('node', [importScript, csvPath], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
if (i.status !== 0) {
  console.error('[clear-and-import] Import failed.');
  process.exit(1);
}

console.log('[clear-and-import] Done.');
