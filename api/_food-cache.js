// Cache public food results inside a warm server instance, AFTER authentication.
// Never edge-cache an authenticated response: a cache hit could skip the gate.
// This is an optimisation, not durable storage or a cross-instance quota.
const results = new Map();
const pending = new Map();
const MAX_ITEMS = 200;
const TTL = 15 * 60 * 1000;
const STALE_TTL = 24 * 60 * 60 * 1000;

export async function cachedFood(key, fetchItems) {
  const existing = results.get(key);
  if (existing && Date.now() - existing.at < TTL) return existing.items;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const items = await fetchItems();
      if (!Array.isArray(items)) throw new Error('invalid_food_response');
      if (items.length) {
        results.delete(key);
        results.set(key, { items, at: Date.now() });
        while (results.size > MAX_ITEMS) results.delete(results.keys().next().value);
      }
      return items;
    } catch (error) {
      if (existing && Date.now() - existing.at < STALE_TTL) return existing.items;
      throw error;
    }
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
