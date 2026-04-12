/**
 * Upload operator tutorial PDFs to Aliyun OSS (application/pdf). Does not set object ACL —
 * many buckets forbid public-read ACL; use a bucket policy allowing GetObject on
 * portal/tutorial/operator/* for anonymous read, or the URLs will 403 until policy is added.
 *
 * Source: docs/nextjs-migration/public/tutorial/operator/*.pdf
 *
 * Usage: node scripts/upload-operator-tutorial-pdfs-to-oss.js
 * Requires: .env with OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const OSS = require('ali-oss');

const PREFIX = 'portal/tutorial/operator';
const SOURCE_DIR = path.join(__dirname, '..', 'docs', 'nextjs-migration', 'public', 'tutorial', 'operator');

function getClient() {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('OSS config missing: OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET');
  }
  return new OSS({ region, bucket, accessKeyId, accessKeySecret });
}

function publicObjectUrl(bucket, region, key) {
  return `https://${bucket}.${region}.aliyuncs.com/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function main() {
  const client = getClient();
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;

  const files = fs.readdirSync(SOURCE_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (!files.length) {
    console.error('No PDF files in', SOURCE_DIR);
    process.exit(1);
  }

  for (const name of files.sort()) {
    const localPath = path.join(SOURCE_DIR, name);
    const key = `${PREFIX}/${name}`;
    const buf = fs.readFileSync(localPath);
    await client.put(key, buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
      },
    });
    console.log('OK', key, `(${(buf.length / 1024).toFixed(0)} KB)`);
  }

  const base = `https://${bucket}.${region}.aliyuncs.com/${PREFIX}`;
  console.log('');
  console.log('Add to docs/nextjs-migration/.env.local (then rebuild portal):');
  console.log(`NEXT_PUBLIC_OPERATOR_TUTORIAL_OSS_BASE=${base}`);
  console.log('');
  const example = publicObjectUrl(bucket, region, `${PREFIX}/${files[0]}`);
  console.log('Example:', example);
  console.log('');
  console.log(
    'If curl returns 403: OSS console → Bucket → Permissions → Bucket Policy → allow oss:GetObject for arn:...:' +
      bucket +
      '/portal/tutorial/operator/* principal *'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
