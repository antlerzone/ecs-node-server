/**
 * @deprecated 已停用：不要在 account 表插入占位行。
 * 请使用：
 *   - `scripts/lib/account-canonical-map.js` + bukkuid CSV 将 Wix type UUID 映射到 canonical account.id
 *   - `scripts/import-rentalcollection.js`（传入 bukkuid CSV 作第二参数源）
 *   - 若库里已有历史占位行：`node scripts/remap-wix-accounts-to-canonical.js [bukkuid.csv]`
 */
console.error(
  '[deprecated] backfill-account-types-from-rental-csv.js no longer inserts placeholder account rows.\n' +
    'Use remap-wix-accounts-to-canonical.js (fix DB) and import-rentalcollection + bukkuid mapping (new imports).'
);
process.exit(1);
