#!/usr/bin/env node
/**
 * Joins server.js mount prefixes with router.(get|post|...) string paths in *.routes.js
 * so you get a flat list of full API paths for audits.
 *
 *   node scripts/scan-express-router-paths.js
 *   node scripts/scan-express-router-paths.js --json > /tmp/api-routes.json
 *
 * Limitations: only static string paths; dynamic req or template literals skipped.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const serverSrc = fs.readFileSync(serverPath, 'utf8');

/** const name = require('./src/modules/foo/bar.routes') */
const requireRe =
  /const\s+(\w+)\s*=\s*require\(\s*['"](\.\/src\/modules\/[^'"]+\.routes(?:\.js)?)['"]\s*\)/g;
const varToModule = new Map();
let rm;
while ((rm = requireRe.exec(serverSrc)) !== null) {
  varToModule.set(rm[1], rm[2]);
}

/** One-line app.use('/api/...', ..., routerVar); skip inline (req,res,next)=> */
const mounts = [];
for (const line of serverSrc.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('app.use(') || !trimmed.includes("'/api/") && !trimmed.includes('"/api/')) continue;
  if (trimmed.includes('=>')) continue;
  const m = trimmed.match(/^app\.use\(\s*['"](\/api\/[^'"]+)['"],\s*(.+)\)\s*;\s*$/);
  if (!m) continue;
  const rest = m[2];
  const segments = rest.split(',').map((s) => s.trim());
  const varName = segments[segments.length - 1];
  if (!/^[A-Za-z_$][\w$]*$/.test(varName)) continue;
  mounts.push({ mount: m[1], varName });
}

/** Allow newlines between ( and opening quote (Prettier-style). */
const routeMethodRe = /router\.(get|post|put|patch|delete|all)\(\s*['"]([^'"]+)['"]/gs;

function scanRouterFile(moduleRel) {
  let rel = moduleRel.replace(/^\.\//, '');
  if (!rel.endsWith('.js')) rel += '.js';
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, 'utf8');
  const out = [];
  let m;
  while ((m = routeMethodRe.exec(txt)) !== null) {
    out.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return out;
}

const fullRoutes = [];
for (const { mount, varName } of mounts) {
  const mod = varToModule.get(varName);
  if (!mod) {
    fullRoutes.push({ mount, varName, error: 'no require() mapping in server.js' });
    continue;
  }
  const sub = scanRouterFile(mod);
  if (sub.length === 0) {
    fullRoutes.push({ mount, module: mod, note: 'no static router.METHOD("...") found (may use Router() in sub-files)' });
  }
  for (const r of sub) {
    const joined = (mount + r.path).replace(/\/+/g, '/');
    fullRoutes.push({
      method: r.method,
      fullPath: joined,
      mount,
      subPath: r.path,
      file: mod
    });
  }
}

const summary = {
  generated: new Date().toISOString(),
  serverJsMounts: mounts.length,
  expandedRoutes: fullRoutes.filter((x) => x.fullPath).length,
  routes: fullRoutes.sort((a, b) => String(a.fullPath || '').localeCompare(String(b.fullPath || '')))
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const r of summary.routes) {
    if (r.fullPath) console.log(`${r.method}\t${r.fullPath}`);
    else console.log(`—\t${JSON.stringify(r)}`);
  }
  console.error(`# mounts: ${summary.serverJsMounts}, expanded: ${summary.expandedRoutes}`);
}
