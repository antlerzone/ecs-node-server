/**
 * Antlerzone site — Velo web module（backend / .jsw）
 *
 * 1) Cleanlemons Wix `/_functions/importFromA` — Bearer = WIX_IMPORT_BEARER（与 Cleanlemons 上 `post_importFromA` 一致）
 * 2) ECS `.../antlerzone-property` — Bearer = ECS_CLIENT_API_KEY（与 `cln_client_integration.api_key` 一致）
 *
 * ⚠️ 密钥写在源码中会被站点成员/发布包看到；生产环境更建议 Wix Secrets。
 */

import { fetch } from 'wix-fetch';

// —— 内联密钥（改这里即可，勿提交到公开仓库）——
const WIX_IMPORT_BEARER = 'super-secure-key-antlerzone2025';
const ECS_CLIENT_API_KEY = 'AFVrl1OaXQcrUL3q0XZ9HWLMVEwJ6p_8zcKEkPV2Thg';

const WIX_IMPORT_ENDPOINT = 'https://www.cleanlemons.com/_functions/importFromA';
const ECS_ENDPOINT =
  'https://api.cleanlemons.com/api/cleanlemon-sync/antlerzone-property';

const fieldMap = {
  title: 'propertyName',
  unitNumber: 'unitName',
  location: 'address',
  contact: 'contact',
  mailboxPassword: 'mailboxPassword',
  bedCount: 'bedCount',
  roomCount: 'roomCount',
  bathroomCount: 'bathroomCount',
  kitchen: 'kitchen',
  livingRoom: 'livingRoom',
  balcony: 'balcony',
  staircase: 'staircase',
  liftLevel: 'liftLevel',
  specialAreaCount: 'specialAreaCount',
  cleaningfees: 'cleaningfees',
  cc: 'cc',
  _id: 'sourceId'
};

function buildPayload(item) {
  const payload = {
    client: 'Antlerzone',
    contact: '60169629627',
    isFromA: true,
    /** Must match `cln_clientdetail.id` for the integration behind ECS_CLIENT_API_KEY (constant-time check on ECS). */
    cleanlemonsClientdetailId: '40f54b0a-1dbf-4417-b305-d9fe42163698'
  };

  for (const [aField, bField] of Object.entries(fieldMap)) {
    const value = item[aField];

    if (aField === 'cc' && Array.isArray(value)) {
      payload[bField] = value.map((img) => ({
        type: 'image',
        src: img?.src || img
      }));
    } else if (value !== undefined) {
      payload[bField] = value;
    }
  }

  return payload;
}

async function postJson(url, bearer, bodyObj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`
    },
    body: JSON.stringify(bodyObj)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

export async function syncPropertyToB(item) {
  const payload = buildPayload(item);

  const out = { wix: null, ecs: null, errors: [] };

  if (WIX_IMPORT_BEARER && String(WIX_IMPORT_BEARER).trim()) {
    try {
      out.wix = await postJson(WIX_IMPORT_ENDPOINT, String(WIX_IMPORT_BEARER).trim(), payload);
      if (out.wix.ok) console.log('A ➜ Cleanlemons Wix importFromA:', out.wix.body);
      else {
        console.error('A ➜ Wix importFromA HTTP', out.wix.status, out.wix.body);
        out.errors.push({ target: 'wix', status: out.wix.status, body: out.wix.body });
      }
    } catch (err) {
      console.error('A ➜ Wix importFromA failed:', err.message);
      out.errors.push({ target: 'wix', error: err.message });
    }
  } else {
    out.errors.push({ target: 'wix', error: 'WIX_IMPORT_BEARER_EMPTY' });
  }

  if (ECS_CLIENT_API_KEY && String(ECS_CLIENT_API_KEY).trim()) {
    try {
      out.ecs = await postJson(ECS_ENDPOINT, String(ECS_CLIENT_API_KEY).trim(), payload);
      if (out.ecs.ok) console.log('A ➜ ECS cln_property:', out.ecs.body);
      else {
        console.error('A ➜ ECS HTTP', out.ecs.status, out.ecs.body);
        out.errors.push({ target: 'ecs', status: out.ecs.status, body: out.ecs.body });
      }
    } catch (err) {
      console.error('A ➜ ECS failed:', err.message);
      out.errors.push({ target: 'ecs', error: err.message });
    }
  } else {
    out.errors.push({ target: 'ecs', error: 'ECS_CLIENT_API_KEY_EMPTY' });
  }

  out.ok = out.wix?.ok === true && out.ecs?.ok === true;
  return out;
}
