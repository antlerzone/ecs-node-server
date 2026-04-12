/**
 * Split combined Wix / legacy `address` text into prose + embedded Waze / Google URLs.
 * Aligns with migration 0236 + `g.co/kgs` short links (import script).
 */

function splitAddressWazeGoogleFromText(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { address: '', wazeUrl: '', googleUrl: '' };
  }
  let s = String(raw);

  let wazeUrl = '';
  const wazeUl = s.match(/https?:\/\/(?:www\.)?waze\.com\/ul\/[a-zA-Z0-9]+/i);
  if (wazeUl) wazeUrl = wazeUl[0];
  else {
    const wazeAny = s.match(/https?:\/\/[^\s]*waze\.com[^\s]*/i);
    if (wazeAny) wazeUrl = wazeAny[0];
  }

  const googlePatterns = [
    /https?:\/\/[^\s]*maps\.app\.goo\.gl[^\s]*/i,
    /https?:\/\/[^\s]*goo\.gl[^\s]*/i,
    /https?:\/\/g\.co\/kgs\/[^\s]*/i,
    /https?:\/\/[^\s]*google\.com\/maps[^\s]*/i,
    /https?:\/\/[^\s]*maps\.google\.com[^\s]*/i,
  ];
  let googleUrl = '';
  for (const re of googlePatterns) {
    const m = s.match(re);
    if (m && m[0]) {
      googleUrl = m[0];
      break;
    }
  }

  let cleaned = s;
  const stripSeq = [
    /https?:\/\/(?:www\.)?waze\.com\/ul\/[a-zA-Z0-9]+/gi,
    /https?:\/\/[^\s]*waze\.com[^\s]*/gi,
    /https?:\/\/[^\s]*maps\.app\.goo\.gl[^\s]*/gi,
    /https?:\/\/[^\s]*goo\.gl[^\s]*/gi,
    /https?:\/\/g\.co\/kgs\/[^\s]*/gi,
    /https?:\/\/[^\s]*google\.com\/maps[^\s]*/gi,
    /https?:\/\/[^\s]*maps\.google\.com[^\s]*/gi,
  ];
  for (const re of stripSeq) {
    cleaned = cleaned.replace(re, '');
  }

  cleaned = cleaned
    .replace(/Waze\s*:\s*/gi, '')
    .replace(/waze\s*:\s*/gi, '')
    .replace(/Google Maps\s*:\s*/gi, '')
    .replace(/Google Map\s*:\s*/gi, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  cleaned = cleaned.replace(/^\*Address:\s*/i, '').replace(/^\*+|\*+$/g, '').trim();

  return {
    address: cleaned,
    wazeUrl: wazeUrl || '',
    googleUrl: googleUrl || '',
  };
}

/** Plain text for `q=` (strip embedded http(s) links so search URLs stay short). */
function clnPlainAddressForNavigationQuery(address) {
  let s = String(address ?? '').trim();
  if (!s) return '';
  const stripped = s.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripped || s;
}

/** Waze + Google Maps search URLs from plain address (no Geocoding API). */
function clnNavigationUrlsFromPlainAddress(address) {
  const q = clnPlainAddressForNavigationQuery(address);
  if (!q) return { wazeUrl: null, googleMapsUrl: null };
  const enc = encodeURIComponent(q);
  return {
    wazeUrl: `https://www.waze.com/ul?q=${enc}`,
    googleMapsUrl: `https://www.google.com/maps?q=${enc}`,
  };
}

function _sanitizeNavUrl(v) {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('blob:')) return null;
  return s;
}

/**
 * Merge embedded links in address + explicit API fields + previous DB values.
 * Used when saving `cln_property` (operator portal, client portal, Coliving sync).
 */
function resolveClnPropertyNavigationUrls({
  nextAddressRaw = '',
  prevAddress = '',
  prevWaze = '',
  prevGoogle = '',
  explicitWaze = false,
  explicitGoogle = false,
  inputWazeVal,
  inputGoogleVal,
} = {}) {
  const split = splitAddressWazeGoogleFromText(nextAddressRaw);
  const prose = String(split.address || '').trim();
  const nextForCompare = prose || String(nextAddressRaw).trim();
  const prevTrim = String(prevAddress).trim();
  const addressChanged = prevTrim !== nextForCompare;
  const auto = clnNavigationUrlsFromPlainAddress(prose || nextAddressRaw);

  let waze = null;
  let google = null;

  if (explicitWaze) {
    waze = _sanitizeNavUrl(inputWazeVal);
  } else if (!nextForCompare) {
    waze = null;
  } else if (String(split.wazeUrl || '').trim()) {
    waze = String(split.wazeUrl).trim();
  } else if (addressChanged || !String(prevWaze).trim()) {
    waze = auto.wazeUrl;
  } else {
    waze = String(prevWaze).trim() || auto.wazeUrl;
  }

  if (explicitGoogle) {
    google = _sanitizeNavUrl(inputGoogleVal);
  } else if (!nextForCompare) {
    google = null;
  } else if (String(split.googleUrl || '').trim()) {
    google = String(split.googleUrl).trim();
  } else if (addressChanged || !String(prevGoogle).trim()) {
    google = auto.googleMapsUrl;
  } else {
    google = String(prevGoogle).trim() || auto.googleMapsUrl;
  }

  return { wazeUrl: waze, googleMapsUrl: google };
}

module.exports = {
  splitAddressWazeGoogleFromText,
  clnPlainAddressForNavigationQuery,
  clnNavigationUrlsFromPlainAddress,
  resolveClnPropertyNavigationUrls,
};
