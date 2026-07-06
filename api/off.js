// DevFit — OpenFoodFacts search proxy (Vercel serverless).
//
// Why this exists: OFF's legacy endpoint (world.openfoodfacts.org/cgi/search.pl)
// is chronically overloaded and often returns an HTML "Page temporarily
// unavailable" instead of JSON — so branded foods (Chobani, MyProtein, etc.)
// silently failed to appear in search. This proxy uses OFF's modern search
// engine (search.openfoodfacts.org, aka search-a-licious), which is fast and
// reliable, and normalises the result into the exact shape the client's
// parseOFF() already expects: { products: [{ code, product_name, brands,
// serving_size, serving_quantity, nutriments:{...} }] }.
//
// Edge-cached so popular queries are instant and OFF isn't hammered.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const q = String((req.query && req.query.query) || '').slice(0, 100).trim();
  let pageSize = parseInt((req.query && req.query.pageSize) || '40', 10);
  if (!Number.isFinite(pageSize)) pageSize = 40;
  pageSize = Math.max(1, Math.min(pageSize, 50));

  if (!q) { res.status(200).json({ products: [] }); return; }

  const fields = [
    'code', 'product_name', 'brands', 'serving_size', 'serving_quantity',
    'nutriments', 'countries_tags', 'unique_scans_n'
  ].join(',');
  const url = 'https://search.openfoodfacts.org/search'
    + '?q=' + encodeURIComponent(q)
    + '&page_size=' + pageSize
    + '&fields=' + encodeURIComponent(fields);

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'DevFit/1.0 (devfitportal.vercel.app)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) { res.status(200).json({ products: [], error: 'off ' + r.status }); return; }
    const j = await r.json();
    const hits = Array.isArray(j.hits) ? j.hits : [];

    // Normalise to the legacy shape parseOFF() reads (brands as a string).
    const products = hits.map((h) => ({
      code: h.code || '',
      product_name: h.product_name || h.product_name_en || '',
      brands: Array.isArray(h.brands) ? h.brands.join(', ') : (h.brands || ''),
      serving_size: h.serving_size || '',
      serving_quantity: h.serving_quantity || '',
      nutriments: h.nutriments || {}
    })).filter((p) => p.product_name && p.nutriments &&
      (p.nutriments['energy-kcal_100g'] || p.nutriments['energy-kcal'] || p.nutriments['energy_100g']));

    // Popular query results are effectively static — let the edge cache them.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ products });
  } catch (e) {
    res.status(200).json({ products: [], error: String(e && e.message || e) });
  }
}
