// Domain tests isolate the new session gate; real session, logout, quota and
// block enforcement are covered separately by session-regression.sql and
// session-lifecycle.test.mjs. No production code imports this fixture.
import crypto from 'node:crypto';
export const deviceId = 'domain-test-device-0001';
export function sessionClaims(claims = {}) {
  return { iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    sid: 'a'.repeat(64), did: crypto.createHash('sha256').update(deviceId).digest('hex'), ...claims };
}
export function domainHandler(handler) {
  return async (req, res) => {
    req.headers = { 'x-devfit-device': deviceId, ...req.headers };
    if (req.method === 'POST') req.body = { deviceId, ...req.body };
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).endsWith('/rpc/authorize_devfit_session')) return original(url, options);
      const args=JSON.parse(options.body);
      if(args.p_route === '/api/food-search') return original(String(url).replace('authorize_devfit_session','authorize_devfit_food_search'),options);
      if(args.p_route === '/api/pro-access') {
        const r=await original(String(url).replace('/rpc/authorize_devfit_session','/devfit_subscribers?email=eq.'+encodeURIComponent(args.p_email)),{});
        if(!r.ok)return r;
        const sub=(await r.json())[0];
        return {ok:true,json:async()=>({status:sub?.approved?'ok':'revoked',subscriber:sub})};
      }
      return {ok:true,json:async()=>({status:'ok',subscriber:{email:args.p_email,approved:true,tier:'free'}})};
    };
    try { return await handler(req,res); } finally { globalThis.fetch=original; }
  };
}
