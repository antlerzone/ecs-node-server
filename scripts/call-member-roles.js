/**
 * One-off: read jwt.txt (single line) and GET /api/portal-auth/member-roles on local API.
 * Usage from repo root: put token in jwt.txt, then: node scripts/call-member-roles.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const jwtPath = path.join(__dirname, '..', 'jwt.txt');
let t;
try {
  t = fs.readFileSync(jwtPath, 'utf8').trim();
} catch (e) {
  console.error('Missing or unreadable jwt.txt in repo root:', jwtPath);
  process.exit(1);
}
const parts = t.split('.');
if (parts.length !== 3) {
  console.error('jwt.txt must be one JWT line with exactly 2 dots, got', parts.length, 'segments');
  process.exit(1);
}

const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/portal-auth/member-roles',
    method: 'GET',
    headers: { Authorization: 'Bearer ' + t },
  },
  (res) => {
    let b = '';
    res.on('data', (c) => {
      b += c;
    });
    res.on('end', () => {
      console.log('STATUS', res.statusCode);
      console.log(b);
    });
  }
);
req.on('error', (e) => console.error(e.message));
req.end();
