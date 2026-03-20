/**
 * Seed demo account: one client (antlerzone@gmail.com), company "DemoAccount",
 * master admin antlerzone@gmail.com. SAAS main = colivingmanagement@gmail.com (env). demoaccount@gmail.com = 訪客 demo as new client.
 * Best pricing plan, 2 tenancies; tenants demo1/demo2 (demo2=demoaccount@gmail.com). Daily 12am: run reset-demo-account.js.
 *
 * Usage: node scripts/seed-demo-account.js
 * Prerequisite: migration 0080, 0081. Env: CNYIOT_LOGIN_NAME, CNYIOT_LOGIN_PSW (SAAS mother) for demo CNYIOT subaccount.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { randomUUID } = require('crypto');
const {
  getTodayMalaysiaDate,
  getTodayPlusDaysMalaysia,
  malaysiaDateToUtcDatetimeForDb
} = require('../src/utils/dateMalaysia');

function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + months);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Fixed UUIDs for demo (for future freeze/snapshot)
const DEMO_CLIENT_ID = 'a0000001-0001-4000-8000-000000000001';
const DEMO_PROFILE_ID = 'a0000001-0001-4000-8000-000000000002';
const DEMO_BANK_ID = 'a0000001-0001-4000-8000-000000000003';
const DEMO_AGREEMENT_TEMPLATE_ID = 'a0000001-0001-4000-8000-000000000004';
const DEMO_OWNER_ID = 'a0000001-0001-4000-8000-000000000005';
const DEMO_PROPERTY_ID = 'a0000001-0001-4000-8000-000000000006';
const DEMO_ROOM_1 = 'a0000001-0001-4000-8000-000000000007';
const DEMO_ROOM_2 = 'a0000001-0001-4000-8000-000000000008';
const DEMO_ROOM_3 = 'a0000001-0001-4000-8000-000000000009';
const DEMO_ROOM_4 = 'a0000001-0001-4000-8000-00000000000a';
const DEMO_TENANT_1_ID = 'a0000001-0001-4000-8000-00000000000b'; // demo1, demo1@gmail.com
const DEMO_TENANT_2_ID = 'a0000001-0001-4000-8000-00000000000c'; // demo2, demoaccount@gmail.com
const DEMO_STAFF_ID = 'a0000001-0001-4000-8000-00000000000d';
const DEMO_TENANCY_1_ID = 'a0000001-0001-4000-8000-00000000000e'; // 3m ago -> 6m later, 600
const DEMO_TENANCY_2_ID = 'a0000001-0001-4000-8000-00000000000f'; // ended 2w ago, 800, for refund
const DEMO_REFUND_DEPOSIT_ID = 'a0000001-0001-4000-8000-000000000010';
const DEMO_CREDIT_ID = 'a0000001-0001-4000-8000-000000000011';
const DEMO_INTEGRATION_ID = 'a0000001-0001-4000-8000-000000000012';
const DEMO_PRICINGPLAN_DETAIL_ID = 'a0000001-0001-4000-8000-000000000013';

const DEMO_CLIENT_EMAIL = 'antlerzone@gmail.com';  // Demo company (clientdetail) + master admin
const DEMO_COMPANY = 'DemoAccount';
const DEMO_SUBDOMAIN = 'demoaccount';             // URL subdomain unchanged

async function main() {
  const conn = await pool.getConnection();
  try {
    const today = getTodayMalaysiaDate();
    const t1Begin = addMonths(today, -3);
    const t1End = addMonths(today, 6);
    const t2End = getTodayPlusDaysMalaysia(-14);
    const t2Begin = addMonths(t2End, -12);
    const t1BeginDb = malaysiaDateToUtcDatetimeForDb(t1Begin);
    const t1EndDb = malaysiaDateToUtcDatetimeForDb(t1End);
    const t2BeginDb = malaysiaDateToUtcDatetimeForDb(t2Begin);
    const t2EndDb = malaysiaDateToUtcDatetimeForDb(t2End);

    // Best (most expensive) pricing plan
    const [planRows] = await conn.query(
      'SELECT id, title FROM pricingplan ORDER BY COALESCE(sellingprice, 0) DESC LIMIT 1'
    );
    if (!planRows.length) {
      throw new Error('No pricingplan found. Create at least one pricing plan first.');
    }
    const bestPlanId = planRows[0].id;
    const bestPlanTitle = planRows[0].title || 'Best Plan';
    const expiredFar = '2099-12-31 00:00:00';

    // 1) bankdetail (one for profile/owner)
    await conn.query(
      `INSERT INTO bankdetail (id, bankname, created_at, updated_at) VALUES (?, 'Demo Bank', NOW(), NOW())
       ON DUPLICATE KEY UPDATE bankname = 'Demo Bank'`,
      [DEMO_BANK_ID]
    );

    // 2) clientdetail
    await conn.query(
      `INSERT INTO clientdetail (id, title, email, status, subdomain, expired, pricingplan_id, currency, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, 'MYR', NOW(), NOW())
       ON DUPLICATE KEY UPDATE title = VALUES(title), email = VALUES(email), status = 1, subdomain = VALUES(subdomain),
         expired = VALUES(expired), pricingplan_id = VALUES(pricingplan_id), currency = VALUES(currency), updated_at = NOW()`,
      [DEMO_CLIENT_ID, DEMO_COMPANY, DEMO_CLIENT_EMAIL, DEMO_SUBDOMAIN, expiredFar, bestPlanId]
    );

    // 3) client_profile (stripe_sandbox=1, is_demo=1; connect can be set by user, daily reset will re-connect if needed)
    await conn.query(
      `INSERT INTO client_profile (id, client_id, subdomain, stripe_sandbox, stripe_platform, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'MY', 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE client_id = VALUES(client_id), subdomain = VALUES(subdomain),
         stripe_sandbox = 1, stripe_platform = VALUES(stripe_platform), is_demo = 1, updated_at = NOW()`,
      [DEMO_PROFILE_ID, DEMO_CLIENT_ID, DEMO_SUBDOMAIN]
    );

    // 4) client_integration (minimal: addonAccount so Connect/account system can be used; if demo disconnects, daily reset can re-connect)
    await conn.query(
      `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, created_at, updated_at)
       VALUES (?, ?, 'addonAccount', 1, 0, 1, 'sql', '{}', NOW(), NOW())
       ON DUPLICATE KEY UPDATE enabled = 1, updated_at = NOW()`,
      [DEMO_INTEGRATION_ID, DEMO_CLIENT_ID]
    );

    // 5) client_credit (default high so demo operator/owner/tenant don't need to top up)
    await conn.query(
      `INSERT INTO client_credit (id, client_id, type, amount, updated_at) VALUES (?, ?, 'flex', 99999, NOW())
       ON DUPLICATE KEY UPDATE amount = 99999, updated_at = NOW()`,
      [DEMO_CREDIT_ID, DEMO_CLIENT_ID]
    );

    // 6) client_pricingplan_detail
    await conn.query(
      `INSERT INTO client_pricingplan_detail (id, client_id, type, plan_id, title, expired, created_at, updated_at)
       VALUES (?, ?, 'plan', ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE plan_id = VALUES(plan_id), title = VALUES(title), expired = VALUES(expired), updated_at = NOW()`,
      [DEMO_PRICINGPLAN_DETAIL_ID, DEMO_CLIENT_ID, bestPlanId, bestPlanTitle, expiredFar]
    );

    // 7) agreementtemplate
    await conn.query(
      `INSERT INTO agreementtemplate (id, client_id, title, created_at, updated_at)
       VALUES (?, ?, 'Demo Agreement', NOW(), NOW())
       ON DUPLICATE KEY UPDATE title = 'Demo Agreement', updated_at = NOW()`,
      [DEMO_AGREEMENT_TEMPLATE_ID, DEMO_CLIENT_ID]
    );

    // 8) ownerdetail (antlerzone@gmail.com)
    await conn.query(
      `INSERT INTO ownerdetail (id, ownername, email, created_at, updated_at)
       VALUES (?, 'Demo Owner', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE ownername = 'Demo Owner', email = VALUES(email), updated_at = NOW()`,
      [DEMO_OWNER_ID, DEMO_CLIENT_EMAIL]
    );
    // owner_client junction (optional if migration 0037/0048 not run)
    try {
      await conn.query(
        `INSERT IGNORE INTO owner_client (id, owner_id, client_id) VALUES (?, ?, ?)`,
        [randomUUID(), DEMO_OWNER_ID, DEMO_CLIENT_ID]
      );
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // 9) propertydetail (1 property, link owner & agreement template after owner exists)
    await conn.query(
      `INSERT INTO propertydetail (id, client_id, shortname, apartmentname, address, active, agreementtemplate_id, owner_id, created_at, updated_at)
       VALUES (?, ?, 'Demo Property', 'Demo Property A', 'Demo Address', 1, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE shortname = 'Demo Property', apartmentname = 'Demo Property A', address = 'Demo Address',
         active = 1, agreementtemplate_id = VALUES(agreementtemplate_id), owner_id = VALUES(owner_id), updated_at = NOW()`,
      [DEMO_PROPERTY_ID, DEMO_CLIENT_ID, DEMO_AGREEMENT_TEMPLATE_ID, DEMO_OWNER_ID]
    );
    try {
      await conn.query(
        `INSERT IGNORE INTO owner_property (id, owner_id, property_id) VALUES (?, ?, ?)`,
        [randomUUID(), DEMO_OWNER_ID, DEMO_PROPERTY_ID]
      );
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // 10) roomdetail (4 rooms)
    const rooms = [
      [DEMO_ROOM_1, 'Room 101'],
      [DEMO_ROOM_2, 'Room 102'],
      [DEMO_ROOM_3, 'Room 103'],
      [DEMO_ROOM_4, 'Room 104']
    ];
    for (const [rid, name] of rooms) {
      await conn.query(
        `INSERT INTO roomdetail (id, client_id, property_id, title_fld, roomname, available, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE title_fld = VALUES(title_fld), roomname = VALUES(roomname), active = 1, updated_at = NOW()`,
        [rid, DEMO_CLIENT_ID, DEMO_PROPERTY_ID, name, name]
      );
    }

    // 11) tenantdetail: demo1 (demo1@gmail.com), demo2 (demoaccount@gmail.com)
    await conn.query(
      `INSERT INTO tenantdetail (id, client_id, fullname, email, created_at, updated_at)
       VALUES (?, ?, 'demo1', 'demo1@gmail.com', NOW(), NOW())
       ON DUPLICATE KEY UPDATE fullname = 'demo1', email = 'demo1@gmail.com', updated_at = NOW()`,
      [DEMO_TENANT_1_ID, DEMO_CLIENT_ID]
    );
    await conn.query(
      `INSERT INTO tenantdetail (id, client_id, fullname, email, created_at, updated_at)
       VALUES (?, ?, 'demo2', 'demoaccount@gmail.com', NOW(), NOW())
       ON DUPLICATE KEY UPDATE fullname = 'demo2', email = 'demoaccount@gmail.com', updated_at = NOW()`,
      [DEMO_TENANT_2_ID, DEMO_CLIENT_ID]
    );
    try {
      await conn.query(`INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)`, [DEMO_TENANT_1_ID, DEMO_CLIENT_ID]);
      await conn.query(`INSERT IGNORE INTO tenant_client (tenant_id, client_id) VALUES (?, ?)`, [DEMO_TENANT_2_ID, DEMO_CLIENT_ID]);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // 12) staffdetail (master admin = antlerzone@gmail.com, is_master=1). 若無 is_master 欄位則不帶入。
    try {
      await conn.query(
        `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, is_master, created_at, updated_at)
         VALUES (?, ?, ?, 'DemoAccount Master', '["admin"]', 1, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE email = VALUES(email), name = 'DemoAccount Master', permission_json = '["admin"]', status = 1, is_master = 1, updated_at = NOW()`,
        [DEMO_STAFF_ID, DEMO_CLIENT_ID, DEMO_CLIENT_EMAIL]
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('is_master')) {
        await conn.query(
          `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, created_at, updated_at)
           VALUES (?, ?, ?, 'DemoAccount Master', '["admin"]', 1, NOW(), NOW())
           ON DUPLICATE KEY UPDATE email = VALUES(email), name = 'DemoAccount Master', permission_json = '["admin"]', status = 1, updated_at = NOW()`,
          [DEMO_STAFF_ID, DEMO_CLIENT_ID, DEMO_CLIENT_EMAIL]
        );
        console.warn('  staffdetail: is_master column missing (run migration 0081), row inserted without it.');
      } else {
        throw e;
      }
    }

    // 13) tenancy 1: 3 months ago -> 6 months later, rental 600, room1, tenant1
    await conn.query(
      `INSERT INTO tenancy (id, client_id, room_id, tenant_id, submitby_id, begin, \`end\`, rental, deposit, active, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 600, 0, 1, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE begin = VALUES(begin), \`end\` = VALUES(\`end\`), rental = 600, active = 1, status = 1, updated_at = NOW()`,
      [DEMO_TENANCY_1_ID, DEMO_CLIENT_ID, DEMO_ROOM_1, DEMO_TENANT_1_ID, DEMO_STAFF_ID, t1BeginDb, t1EndDb]
    );
    // tenancy 2: ended 2 weeks ago, rental 800, deposit 800 (for refund), room2, tenant2
    await conn.query(
      `INSERT INTO tenancy (id, client_id, room_id, tenant_id, submitby_id, begin, \`end\`, rental, deposit, active, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 800, 800, 1, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE begin = VALUES(begin), \`end\` = VALUES(\`end\`), rental = 800, deposit = 800, active = 1, status = 1, updated_at = NOW()`,
      [DEMO_TENANCY_2_ID, DEMO_CLIENT_ID, DEMO_ROOM_2, DEMO_TENANT_2_ID, DEMO_STAFF_ID, t2BeginDb, t2EndDb]
    );

    // 14) refunddeposit for tenancy 2 (ended 2w ago, needs refund)
    await conn.query(
      `INSERT INTO refunddeposit (id, client_id, tenancy_id, room_id, tenant_id, amount, done, roomtitle, tenantname, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 800, 0, 'Room 102', 'demo2', NOW(), NOW())
       ON DUPLICATE KEY UPDATE amount = 800, done = 0, tenancy_id = VALUES(tenancy_id), room_id = VALUES(room_id), tenant_id = VALUES(tenant_id), updated_at = NOW()`,
      [DEMO_REFUND_DEPOSIT_ID, DEMO_CLIENT_ID, DEMO_TENANCY_2_ID, DEMO_ROOM_2, DEMO_TENANT_2_ID]
    );

    // Room available: room1 occupied by tenancy1 (0); room2 tenancy ended so available (1); room3,4 available (1)
    await conn.query(
      `UPDATE roomdetail SET available = 0 WHERE id = ?`,
      [DEMO_ROOM_1]
    );
    await conn.query(
      `UPDATE roomdetail SET available = 1 WHERE id IN (?, ?, ?)`,
      [DEMO_ROOM_2, DEMO_ROOM_3, DEMO_ROOM_4]
    );

    // 15) Demo account CNYIOT subaccount (from SAAS mother env CNYIOT_LOGIN_NAME/PSW)
    try {
      const { ensureClientCnyiotSubuser } = require('../src/modules/cnyiot/lib/cnyiotSubuser');
      const [intRows] = await conn.query(
        `SELECT id FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' LIMIT 1`,
        [DEMO_CLIENT_ID]
      );
      if (!intRows.length) {
        const intId = randomUUID();
        const now2 = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        await conn.query(
          `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, created_at, updated_at)
           VALUES (?, ?, 'meter', 1, 0, 1, 'cnyiot', '{}', ?, ?)`,
          [intId, DEMO_CLIENT_ID, now2, now2]
        );
      }
      const result = await ensureClientCnyiotSubuser(DEMO_CLIENT_ID);
      console.log('  Demo CNYIOT subaccount:', result.subdomain, 'id', result.cnyiot_subuser_id);
    } catch (e) {
      console.warn('  Demo CNYIOT subaccount skip (set CNYIOT_LOGIN_NAME/CNYIOT_LOGIN_PSW):', e?.message || e);
    }

    console.log('Demo account seeded.');
    console.log('  Client:', DEMO_CLIENT_EMAIL, '| Company:', DEMO_COMPANY, '| Subdomain:', DEMO_SUBDOMAIN);
    console.log('  Master admin:', DEMO_CLIENT_EMAIL, '| Plan:', bestPlanTitle);
    console.log('  Tenancy 1: begin', t1Begin, 'end', t1End, 'rental 600');
    console.log('  Tenancy 2: begin', t2Begin, 'end', t2End, 'rental 800, deposit 800 (refund row created)');
    console.log('  Tenants: demo1 (demo1@gmail.com), demo2 (demoaccount@gmail.com = demo as new client)');
    console.log('  12am reset: node scripts/reset-demo-account.js');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
