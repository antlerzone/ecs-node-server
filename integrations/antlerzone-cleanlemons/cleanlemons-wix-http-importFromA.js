/**
 * Cleanlemons site — paste into backend/http-functions.js (or dedicated file + export).
 * Wix Dashboard: HTTP function URL stays e.g. POST .../_functions/importFromA
 *
 * Secrets (Wix Secrets Manager):
 *   - AntlerzoneImportSecret: Bearer token Antlerzone Velo sends (must match ECS ANTLERZONE_CLEANLEMONS_SYNC_SECRET if you use one shared secret).
 *   - AntlerzoneEcsSyncSecret (optional): Bearer for Wix → ECS; if omitted, AntlerzoneImportSecret is reused.
 *
 * Env-style constants: set PROPERTY_COLLECTION to your CMS collection (default Listing2023).
 */

import { ok, badRequest, serverError } from 'wix-http-functions';
import { fetch } from 'wix-fetch';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';

/** Change to your property/listing collection id (Wix CMS). */
const PROPERTY_COLLECTION = 'Listing2023';

/** Cleanlemons API base (no trailing slash). */
const ECS_SYNC_URL = 'https://api.cleanlemons.com/api/cleanlemon-sync/antlerzone-property';

function unauthorized(body) {
  return {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function pickWixFields(body) {
  const keys = [
    'propertyName',
    'unitName',
    'address',
    'contact',
    'mailboxPassword',
    'bedCount',
    'roomCount',
    'bathroomCount',
    'kitchen',
    'livingRoom',
    'balcony',
    'staircase',
    'liftLevel',
    'specialAreaCount',
    'cleaningfees',
    'cc',
    'client',
    'isFromA',
    'sourceId'
  ];
  const out = {};
  for (const k of keys) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

export async function post_importFromA(request) {
  try {
    const expect = await getSecret('AntlerzoneImportSecret');
    const auth = request.headers.authorization || '';
    const m = /^Bearer\s+(\S+)/i.exec(auth);
    const token = m ? m[1].trim() : '';
    if (!expect || token !== expect) {
      return unauthorized({ ok: false, error: 'Unauthorized' });
    }

    let body;
    try {
      body = await request.body.json();
    } catch {
      return badRequest({ ok: false, error: 'Invalid JSON' });
    }
    if (!body || typeof body !== 'object') {
      return badRequest({ ok: false, error: 'Invalid body' });
    }

    const sourceId = body.sourceId || body.source_id;
    if (!sourceId) {
      return badRequest({ ok: false, error: 'Missing sourceId' });
    }

    const wixPayload = pickWixFields(body);

    const q = await wixData.query(PROPERTY_COLLECTION).eq('sourceId', sourceId).limit(1).find();
    let wixId;
    if (q.items.length) {
      const existing = q.items[0];
      wixId = existing._id;
      await wixData.update(PROPERTY_COLLECTION, { ...existing, ...wixPayload, _id: wixId });
    } else {
      const ins = await wixData.insert(PROPERTY_COLLECTION, wixPayload);
      wixId = ins._id;
    }

    let ecsBearer;
    try {
      ecsBearer = await getSecret('AntlerzoneEcsSyncSecret');
    } catch {
      ecsBearer = null;
    }
    const ecsSecret = ecsBearer || expect;

    const ecsRes = await fetch(ECS_SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ecsSecret}`
      },
      body: JSON.stringify(body)
    });

    const ecsText = await ecsRes.text();
    let ecsJson;
    try {
      ecsJson = JSON.parse(ecsText);
    } catch {
      ecsJson = { raw: ecsText };
    }

    if (!ecsRes.ok) {
      console.error('[importFromA] ECS sync failed', ecsRes.status, ecsJson);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          reason: 'ECS_SYNC_FAILED',
          wixId,
          ecsStatus: ecsRes.status,
          ecsBody: ecsJson
        })
      };
    }

    return ok({
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true, wixId, ecs: ecsJson }
    });
  } catch (err) {
    console.error('[importFromA]', err);
    return serverError({
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, error: err.message || 'sync failed' }
    });
  }
}
