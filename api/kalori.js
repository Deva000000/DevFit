// DevFit — Kalori API proxy (kalori-api.my) for Malaysian food data.
//
// Free public API, no key required. Proxied server-side to:
//   1. Keep browser requests same-origin
//   2. Authenticate and rate-limit requests
//   3. Allow graceful fallback if the API is down

import { foodSearchIdentity, recordServerEvent } from './_lib.js';

// kalori-api.my has had multi-hour timeout periods. Remember one failure in a
// warm function instance and stop calling the unhealthy upstream for ten
// minutes. USDA, Open Food Facts and DevFit's local database continue serving
// results, while one unavailable optional source cannot add five seconds to
// every search or flood monitoring/storage.
const KALORI_COOLDOWN_MS = 10 * 60 * 1000;
let kaloriUnavailableUntil = 0;

function unavailable(res, error) {
  // Never cache the authenticated HTTP response at the edge.
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ data: [], error });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ data: [], error: 'method' }); return; }
  const identity = await foodSearchIdentity(req);
  if (!identity.ok) {
    if (identity.retryAfter) res.setHeader('Retry-After', String(identity.retryAfter));
    res.status(identity.status).json({ data: [], error: identity.error }); return;
  }

  const q = String((req.query && req.query.q) || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').slice(0, 100).trim();
  if (!q) { res.status(200).json({ data: [] }); return; }

  if (Date.now() < kaloriUnavailableUntil) {
    unavailable(res, 'kalori temporarily unavailable');
    return;
  }

  const url = 'https://api.kalori-api.my/api/v1/foods/search?q=' + encodeURIComponent(q) + '&per_page=30';

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) {
      kaloriUnavailableUntil = Date.now() + KALORI_COOLDOWN_MS;
      await recordServerEvent('food_timeout', 'Kalori upstream returned ' + r.status, { page: '/api/kalori', status: r.status });
      unavailable(res, 'food_provider_unavailable'); return;
    }
    const j = await r.json();
    kaloriUnavailableUntil = 0;
    // Normalise: API may return { data: [...] } or { foods: [...] } or bare array
    const items = Array.isArray(j) ? j : (j.data || j.foods || j.results || []);
    res.status(200).json({ data: items });
  } catch (e) {
    kaloriUnavailableUntil = Date.now() + KALORI_COOLDOWN_MS;
    await recordServerEvent('food_timeout', String(e && e.message || e), { page: '/api/kalori', status: 502 });
    unavailable(res, 'food_provider_unavailable');
  }
}
