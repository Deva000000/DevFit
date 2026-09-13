// DevFit — USDA FoodData Central proxy (Vercel serverless function).
//
// Why this exists: the USDA API key must NOT ship in client JS (anyone can view
// source, steal it, and burn the rate limit). This function holds the key
// server-side. Set it once in the Vercel dashboard:
//   Project → Settings → Environment Variables → USDA_KEY = <your key>
// Get a free key in ~30s: https://fdc.nal.usda.gov/api-key-signup.html
//
// Until USDA_KEY is set it falls back to DEMO_KEY (works, just rate-limited),
// so food search keeps working from day one. OpenFoodFacts (client-side, no key)
// remains the primary source for branded/Malaysian products + barcodes.

import { foodSearchIdentity, recordServerEvent } from './_lib.js';
import { cachedFood } from './_food-cache.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ foods: [], error: 'method' }); return; }
  const identity = await foodSearchIdentity(req);
  if (!identity.ok) {
    if (identity.retryAfter) res.setHeader('Retry-After', String(identity.retryAfter));
    res.status(identity.status).json({ foods: [], error: identity.error }); return;
  }

  const key = process.env.USDA_KEY || 'DEMO_KEY';
  const query = String((req.query && req.query.query) || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').slice(0, 100).trim();
  let pageSize = parseInt((req.query && req.query.pageSize) || '25', 10);
  if (!Number.isFinite(pageSize)) pageSize = 25;
  pageSize = Math.max(1, Math.min(pageSize, 50));

  if (!query) {
    res.status(200).json({ foods: [] });
    return;
  }

  // Generic/whole foods ONLY (Foundation, SR Legacy, FNDDS). We deliberately
  // exclude USDA "Branded": it's ~1M US supermarket SKUs that match on the brand
  // name — so "impact whey" surfaced "Melster Circus Peanuts by IMPACT CONFECTIONS"
  // and other US candy that isn't even sold here. Branded/supplement search is
  // OpenFoodFacts' job (api/off.js); USDA is here for lab-accurate whole foods.
  // requireAllWords tightens relevance so a single stray token can't drag in junk.
  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(key);

  try {
    // USDA documents dataType as a JSON array. The former comma-delimited GET
    // parameter now returns HTTP 400, silently removing every USDA result.
    const foods = await cachedFood('usda:' + query.toLowerCase() + ':' + pageSize, async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query,
        pageSize,
        dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)']
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) {
      throw new Error('usda ' + r.status);
    }
    const j = await r.json();
    if (!Array.isArray(j.foods)) throw new Error('invalid_food_response');
    return j.foods;
    });
    res.status(200).json({ foods });
  } catch (e) {
    await recordServerEvent('food_timeout', String(e && e.message || e), { page: '/api/usda', status: 502 });
    res.status(200).json({ foods: [], error: String(e && e.message || e) });
  }
}
