#!/usr/bin/env node
/**
 * Check if an email exists in tenantdetail and has tenancies.
 * Usage: node scripts/check-tenant-by-email.js <email>
 * Example: node scripts/check-tenant-by-email.js starcity.shs@gmail.com
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/check-tenant-by-email.js <email>');
    process.exit(1);
  }

  const norm = String(email).trim().toLowerCase();
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [tenantRows] = await pool.query(
      'SELECT id, fullname, email FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [norm]
    );
    if (!tenantRows.length) {
      console.log('❌ No tenantdetail row for email:', email);
      const [any] = await pool.query(
        'SELECT id, email FROM tenantdetail WHERE email LIKE ? LIMIT 5',
        [`%${email.split('@')[0]}%`]
      );
      if (any.length) console.log('   Similar emails in tenantdetail:', any.map(r => r.email));
      process.exit(1);
    }

    const tenant = tenantRows[0];
    console.log('✅ Tenant found:', { id: tenant.id, email: tenant.email, fullname: tenant.fullname });

    const [tenancyRows] = await pool.query(
      'SELECT id, room_id, client_id, `begin`, `end`, status FROM tenancy WHERE tenant_id = ? ORDER BY begin DESC',
      [tenant.id]
    );
    console.log('   Tenancies:', tenancyRows.length);
    tenancyRows.forEach((t, i) => {
      console.log(`   - ${i + 1}: id=${t.id} room=${t.room_id} status=${t.status} ${t.begin}~${t.end}`);
    });

    if (tenancyRows.length === 0) {
      console.log('⚠️  No tenancies for this tenant. Add tenancy with tenant_id =', tenant.id);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
