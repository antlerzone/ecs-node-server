/**
 * Upload homedemo Section 3 phone screenshots to Aliyun OSS (image/jpeg).
 *
 * Source: docs/nextjs-migration/homedemo-screenshot-upload/
 * Dest:   portal/homedemo/<sanitized-name>.jpeg
 *
 * Usage: node scripts/upload-homedemo-screenshots-to-oss.js
 * Requires: .env with OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 *
 * On success, deletes local source files (ECS disk cleanup).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const OSS = require("ali-oss");

const PREFIX = "portal/homedemo";
const SOURCE_DIR = path.join(
  __dirname,
  "..",
  "docs",
  "nextjs-migration",
  "homedemo-screenshot-upload"
);

/** Local filename → OSS object name (no spaces) */
const FILES = [
  ["step 1.jpeg", "step-1.jpeg"],
  ["step 1.2.jpeg", "step-1-2.jpeg"],
  ["step 2.jpeg", "step-2.jpeg"],
  ["step 2.1.jpeg", "step-2-1.jpeg"],
  ["step 2.2.jpeg", "step-2-2.jpeg"],
  ["step 2.3.jpeg", "step-2-3.jpeg"],
  ["step 2.4.jpeg", "step-2-4.jpeg"],
  ["step 2.5.jpeg", "step-2-5.jpeg"],
  ["step 3.0.jpeg", "step-3-0.jpeg"],
  ["step 3.1.jpeg", "step-3-1.jpeg"],
  ["step 4.jpeg", "step-4.jpeg"],
  ["step 4.2.jpeg", "step-4-2.jpeg"],
  ["step 5.jpeg", "step-5.jpeg"],
  ["tenant smart door.jpeg", "tenant-smart-door.jpeg"],
];

function getClient() {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error("OSS config missing: OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET");
  }
  return new OSS({ region, bucket, accessKeyId, accessKeySecret });
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error("Missing directory:", SOURCE_DIR);
    process.exit(1);
  }

  const client = getClient();
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;

  for (const [localName, destName] of FILES) {
    const localPath = path.join(SOURCE_DIR, localName);
    if (!fs.existsSync(localPath)) {
      if (localName === "step 2.5.jpeg") {
        console.warn("Skip optional (add later):", localPath);
        continue;
      }
      console.error("Missing file:", localPath);
      process.exit(1);
    }
    const key = `${PREFIX}/${destName}`;
    const buf = fs.readFileSync(localPath);
    await client.put(key, buf, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    console.log("OK", key, `(${(buf.length / 1024).toFixed(0)} KB)`);
  }

  const base = `https://${bucket}.${region}.aliyuncs.com/${PREFIX}`;
  console.log("");
  console.log("Public base (use in NEXT_PUBLIC_HOMEDEMO_SCREENSHOT_OSS_BASE or hardcode):");
  console.log(base);
  console.log("");

  for (const [localName] of FILES) {
    const localPath = path.join(SOURCE_DIR, localName);
    if (!fs.existsSync(localPath)) continue;
    fs.unlinkSync(localPath);
    console.log("Removed local:", localPath);
  }

  console.log("");
  console.log(
    "If images 403: OSS bucket policy → allow GetObject for arn:...:" + bucket + "/" + PREFIX + "/*"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
