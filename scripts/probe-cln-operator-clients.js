require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const OP = process.argv[2] || 'e48b2c25-399a-11f1-a4e2-00163e006722';

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [rows] = await c.query(
    `SELECT cd.id, cd.fullname, cd.email
     FROM cln_clientdetail cd
     INNER JOIN cln_client_operator co ON co.clientdetail_id = cd.id
     WHERE co.operator_id = ?
     ORDER BY cd.fullname`,
    [OP]
  );
  console.log('operator', OP, 'linked cln_clientdetail:', rows.length);
  for (const r of rows) {
    console.log(r.id, '|', (r.fullname || '').trim(), '|', (r.email || '').trim());
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
