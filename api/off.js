// DevFit — OpenFoodFacts search proxy (Vercel serverless).
//
// OFF has TWO search backends and BOTH go down independently, so we never rely
// on just one — that's exactly how "MyProtein whey" silently vanished before:
//
//   1. search.openfoodfacts.org (search-a-licious) — fast + modern, but has been
//      returning 502 for extended stretches.
//   2. world.openfoodfacts.org/cgi/search.pl (legacy) — older + sometimes slow,
//      but independently hosted and up when #1 is down (and vice-versa).
//
// Strategy: try the modern engine first; if it errors OR returns nothing, fall
// back to the legacy engine. Whichever answers, we normalise to the ONE shape
// the client's parseOFF() expects: { products: [{ code, product_name, brands,
// serving_size, serving_quantity, nutriments:{...} }] } with brands as a string.
//
// Successful queries are cached in the server after the account check.

import { foodSearchIdentity, recordServerEvent } from './_lib.js';
import { cachedFood } from './_food-cache.js';

const UA = 'DevFit/1.0 (devfitportal.vercel.app)';

// Keep only products that actually have a name and an energy value — anything
// else can't be logged. brands is coerced to a string (search-a-licious returns
// an array, legacy returns a string).
function normalise(products) {
  return (products || []).map((p) => ({
    code: p.code || '',
    product_name: p.product_name || p.product_name_en || '',
    brands: Array.isArray(p.brands) ? p.brands.join(', ') : (p.brands || ''),
    serving_size: p.serving_size || '',
    serving_quantity: p.serving_quantity || '',
    nutriments: p.nutriments || {}
  })).filter((p) => p.product_name && p.nutriments &&
    (p.nutriments['energy-kcal_100g'] || p.nutriments['energy-kcal'] || p.nutriments['energy_100g']));
}

// Modern engine (search-a-licious). Returns [] on any failure so the caller
// falls through to legacy.
async function searchModern(q, pageSize) {
  const fields = 'code,product_name,brands,serving_size,serving_quantity,nutriments';
  const url = 'https://search.openfoodfacts.org/search'
    + '?q=' + encodeURIComponent(q)
    + '&page_size=' + pageSize
    + '&fields=' + encodeURIComponent(fields);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const j = await r.json();
    return normalise(Array.isArray(j.hits) ? j.hits : []);
  } catch (e) { return []; }
}

// Legacy engine (cgi/search.pl). Default sort is by popularity, so the
// most-scanned real products (e.g. MyProtein Impact Whey) come first.
// One bounded fallback attempt avoids multiplying load during provider outages.
async function searchLegacy(q, pageSize) {
  const fields = 'code,product_name,brands,serving_size,serving_quantity,nutriments';
  const url = 'https://world.openfoodfacts.org/cgi/search.pl'
    + '?search_terms=' + encodeURIComponent(q)
    + '&search_simple=1&action=process&json=1'
    + '&page_size=' + pageSize
    + '&fields=' + encodeURIComponent(fields);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3500) });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('json')) {
        const j = await r.json();
        return normalise(Array.isArray(j.products) ? j.products : []);
      }
    } catch (e) { /* report source unavailability below */ }
  throw new Error('food_provider_unavailable');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ products: [], error: 'method' }); return; }
  const identity = await foodSearchIdentity(req);
  if (!identity.ok) {
    if (identity.retryAfter) res.setHeader('Retry-After', String(identity.retryAfter));
    res.status(identity.status).json({ products: [], error: identity.error }); return;
  }

  const q = String((req.query && req.query.query) || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').slice(0, 100).trim();
  let pageSize = parseInt((req.query && req.query.pageSize) || '40', 10);
  if (!Number.isFinite(pageSize)) pageSize = 40;
  pageSize = Math.max(1, Math.min(pageSize, 50));

  if (!q) { res.status(200).json({ products: [] }); return; }

  try {
    // Try the fast modern engine; if it's down or empty, fall back to legacy.
    const products = await cachedFood('off:' + q.toLowerCase() + ':' + pageSize, async () => {
      const first = await searchModern(q, pageSize);
      return first.length ? first : await searchLegacy(q, pageSize);
    });

    // HTTP response stays private so every new request passes authorization.
    res.status(200).json({ products });
  } catch (e) {
    await recordServerEvent('food_timeout', String(e && e.message || e), { page: '/api/off', status: 502 });
    res.status(200).json({ products: [], error: 'food_provider_unavailable' });
  }
}
