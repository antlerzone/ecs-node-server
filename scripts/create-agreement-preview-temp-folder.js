#!/usr/bin/env node
/**
 * One-time: create a folder in the Service Account's Drive for agreement preview temp copies.
 * This avoids "Drive storage quota exceeded" when the operator's folder is full.
 *
 * Run: node scripts/create-agreement-preview-temp-folder.js
 * Then set in .env: AGREEMENT_PREVIEW_TEMP_FOLDER_ID=<printed-id>
 */

require('dotenv').config();
const { google } = require('googleapis');

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyJson) {
    try {
      const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      return new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
      });
    } catch (e) {
      return null;
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
    });
  }
  return null;
}

async function main() {
  const auth = getAuth();
  if (!auth) {
    console.error('Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: {
      name: 'Agreement Preview Temp',
      mimeType: 'application/vnd.google-apps.folder'
    }
  });
  const id = res.data.id;
  if (!id) {
    console.error('Failed to create folder.');
    process.exit(1);
  }
  console.log('Created folder in Service Account Drive.');
  console.log('Set in .env:');
  console.log('AGREEMENT_PREVIEW_TEMP_FOLDER_ID=' + id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
