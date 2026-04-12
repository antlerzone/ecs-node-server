#!/usr/bin/env node
/**
 * Lists every Express app.use/app.post mount under /api from server.js (single source of truth).
 * Use for manual or timezone audit checklists: node scripts/list-api-route-mounts.js
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

const mounts = [];

const useRe = /app\.use\(\s*['"](\/api\/[^'"]+)['"]/g;
let m;
while ((m = useRe.exec(src)) !== null) {
  mounts.push({ type: 'use', path: m[1] });
}

const postRe = /app\.post\(\s*['"](\/api\/[^'"]+)['"]/g;
while ((m = postRe.exec(src)) !== null) {
  mounts.push({ type: 'post', path: m[1] });
}

const seen = new Set();
const unique = [];
for (const x of mounts) {
  const key = `${x.type} ${x.path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(x);
}

unique.sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));

console.log(JSON.stringify({ source: 'server.js', count: unique.length, mounts: unique }, null, 2));
