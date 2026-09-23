/* Shared food request cache. No diary data or tokens are persisted here. */
(function (global) {
  'use strict';
  const cache = new Map(), pending = new Map();
  const TTL = 10 * 60 * 1000;
  let accountToken = '';
  function response(data) {
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  async function search(url) {
    if (!/^\/api\/(off|usda|kalori)\?/.test(String(url))) throw new Error('invalid food endpoint');
    const token = global.DevFitAuth && global.DevFitAuth.getToken();
    if (!token) throw new Error('sign in required');
    if (accountToken !== token) { cache.clear(); pending.clear(); accountToken = token; }
    const key = String(url), previous = cache.get(key);
    if (previous && Date.now() - previous.at < TTL) return response(previous.data);
    if (pending.has(key)) return (await pending.get(key)).clone();
    const promise = (async () => {
      let deviceId = 'unknown';
      try { deviceId = (global.localStorage && global.localStorage.getItem('devfit_device_id')) || 'unknown'; } catch (_) {}
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15000), cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token, 'X-DevFit-Device': deviceId }
      });
      if (r.ok) {
        const data = await r.clone().json();
        const list = data.products || data.foods || data.data;
        if (!data.error && Array.isArray(list) && list.length && accountToken === token) {
          cache.delete(key); cache.set(key, { at: Date.now(), data });
          while (cache.size > 150) cache.delete(cache.keys().next().value);
        }
      }
      return r;
    })();
    pending.set(key, promise);
    try { return (await promise).clone(); }
    finally { if (pending.get(key) === promise) pending.delete(key); }
  }
  global.DevFitFoodSearch = { search };
})(window);
