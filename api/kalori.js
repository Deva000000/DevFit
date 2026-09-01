// DevFit — Kalori API proxy (kalori-api.my) for Malaysian food data.
//
// Free public API, no key required. Proxied server-side to:
//   1. Add CORS headers (API doesn't send them for all origins)
//   2. Cache results at the edge so repeated searches are instant
//   3. Allow graceful fallback if the API is down

import { sameSiteOnly, recordServerEvent } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ data: [], error: 'method' }); return; }
  if (!sameSiteOnly(req)) { res.status(200).json({ data: [] }); return; }

  const q = String((req.query && req.query.q) || '').slice(0, 100).trim();
  if (!q) { res.status(200).json({ data: [] }); return; }

  const url = 'https://api.kalori-api.my/api/v1/foods/search?q=' + encodeURIComponent(q) + '&per_page=30';

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) {
      await recordServerEvent('food_timeout', 'Kalori upstream returned ' + r.status, { page: '/api/kalori', status: r.status });
      res.status(200).json({ data: [], error: 'kalori ' + r.status }); return;
    }
    const j = await r.json();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    // Normalise: API may return { data: [...] } or { foods: [...] } or bare array
    const items = Array.isArray(j) ? j : (j.data || j.foods || j.results || []);
    res.status(200).json({ data: items });
  } catch (e) {
    await recordServerEvent('food_timeout', String(e && e.message || e), { page: '/api/kalori', status: 502 });
    res.status(200).json({ data: [], error: String(e && e.message || e) });
  }
}
