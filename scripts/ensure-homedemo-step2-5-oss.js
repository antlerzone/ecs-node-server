/**
 * Step 2 最后一帧使用 portal/homedemo/step-2-5.jpeg。
 * 若 OSS 上缺失该对象，则从 step-2-4.jpeg 复制一份，避免 homedemo 白屏。
 *
 * Usage: node scripts/ensure-homedemo-step2-5-oss.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const OSS = require("ali-oss");

const DEST = "portal/homedemo/step-2-5.jpeg";
const SOURCE = "portal/homedemo/step-2-4.jpeg";

function getClient() {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error("OSS config missing");
  }
  return new OSS({ region, bucket, accessKeyId, accessKeySecret });
}

async function main() {
  const client = getClient();
  try {
    await client.head(DEST);
    console.log("OK:", DEST, "already exists — no copy.");
    return;
  } catch (err) {
    if (err.status !== 404 && err.code !== "NoSuchKey") {
      throw err;
    }
  }
  await client.copy(DEST, SOURCE);
  console.log("Created", DEST, "by copying", SOURCE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
