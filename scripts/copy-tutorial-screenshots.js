/**
 * Copy tutorial screenshots from docs/tutorial/screenshots to Next.js public/tutorial
 * so the /tutorial page can display them. Run from project root:
 *   node scripts/copy-tutorial-screenshots.js
 *
 * Supports: owner (login.png, portal.png, owner.*.png, owner-properties.png);
 *           tenant (tenant-*.png + aliases); operator (operator-*.png + operator*.png aliases).
 */

const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "docs", "tutorial", "screenshots");
const PUBLIC = path.join(__dirname, "..", "docs", "nextjs-migration", "public", "tutorial");

const OWNER_MAP = [
  ["login.png", "login.png"],
  ["owner.login.png", "login.png"],
  ["portal.png", "portal.png"],
  ["owner.png", "portal.png"],
  ["owner.profile.png", "owner.profile.png"],
  ["owner.properties.png", "owner.properties.png"],
  ["owner-properties.png", "owner.properties.png"],
  ["owner.agreement.png", "owner.agreement.png"],
  ["owner.report.png", "owner.report.png"],
  ["owner.cost.png", "owner.cost.png"],
  ["owner.approval.png", "owner.approval.png"],
  ["owner.smart.door.png", "owner.smart.door.png"],
];

// Your filenames (no hyphen after "operator") -> tutorial expected names
const OPERATOR_ALIAS = {
  "operatordashboard.png": "operator-02-main.png",
  "operatorcompanyestting.png": "operator-03-company-form.png",
  "operatorprofile.png": "operator-03-company-form.png",
  "operatorintegration.png": "operator-07-integration.png",
  "operatoraccounting.png": "operator-08-accounting-connect.png",
  "operatortenancy.png": "operator-10-tenancy-list.png",
  "operatortenantinvoice.png": "operator-11-invoice-list.png",
  "operatorexpenses.png": "operator-13-expenses-list.png",
  "operatorfeedback.png": "operator-16-admin-list.png",
  "operatordepositrefund.png": "operator-18-refund-box.png",
  "operatorbilling&plan.png": "operator-21-billing-credit.png",
  "operatorcreditlog.png": "operator-21-billing-credit.png",
};

// Tenant aliases (your names -> tutorial expected names)
const TENANT_ALIAS = {
  "tenant-04-profile.png": "tenant-03-profile-form.png",
  "tenant-agreement.png": "tenant-07-agreement-list.png",
  "tenant-approval.png": "tenant-06-approve-operator.png",
  "tenant-feedback.png": "tenant-17-feedback-form.png",
  "tenant-payment.png": "tenant-15-payment-list.png",
  "tenant-smartdoor.png": "tenant-13-smartdoor-section.png",
};

function copyOne(srcDir, destDir, srcName, destName) {
  const src = path.join(srcDir, srcName);
  const dest = path.join(destDir, destName);
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

let copied = 0;
const destOwner = path.join(PUBLIC, "owner");
const destTenant = path.join(PUBLIC, "tenant");
const destOperator = path.join(PUBLIC, "operator");

for (const [from, to] of OWNER_MAP) {
  if (copyOne(SOURCE, destOwner, from, to)) {
    console.log("owner:", from, "->", to);
    copied++;
  }
}

if (!fs.existsSync(SOURCE)) {
  console.warn("Source folder not found:", SOURCE);
  process.exit(0);
}

const files = fs.readdirSync(SOURCE);
for (const f of files) {
  if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
  const lower = f.toLowerCase();

  // Tenant: tenant-* or tenant*.png; use alias if defined
  if (f.startsWith("tenant-") || f.startsWith("tenant")) {
    const destName = TENANT_ALIAS[lower] !== undefined ? TENANT_ALIAS[lower] : f;
    if (copyOne(SOURCE, destTenant, f, destName)) {
      console.log("tenant:", f, destName !== f ? "-> " + destName : "");
      copied++;
    }
  }
  // Operator: operator-* or operator*.png (e.g. operatortenantinvoice.png); use alias if defined
  if (f.startsWith("operator-") || f.startsWith("operator")) {
    const destName = OPERATOR_ALIAS[lower] !== undefined ? OPERATOR_ALIAS[lower] : f;
    if (copyOne(SOURCE, destOperator, f, destName)) {
      console.log("operator:", f, destName !== f ? "-> " + destName : "");
      copied++;
    }
  }
}

console.log("\nCopied", copied, "file(s). Tutorial images: public/tutorial/{owner,tenant,operator}/");
