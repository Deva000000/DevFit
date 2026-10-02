// Public, non-sensitive production health probe for automated monitoring.
import { haveServerConfig, sbRpc, SB_URL } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'method' });
    return;
  }
  if (!haveServerConfig()) {
    res.status(503).json({ ok: false, service: 'devfit', database: 'not_configured' });
    return;
  }
  const started = Date.now();
  const health = await sbRpc('devfit_sync_health', {}, 8000);
  if (!health || health.ok !== true) {
    res.status(503).json({ ok: false, service: 'devfit', database: 'unavailable' });
    return;
  }
  const projectRef = new URL(SB_URL).hostname.split('.')[0];
  const isolated = process.env.DEVFIT_ENVIRONMENT === 'staging'
    && projectRef !== 'zngberygrzpkhiqrrzwj'
    && projectRef === process.env.DEVFIT_LOAD_PROJECT_REF;
  res.status(200).json({ ok: true, service: 'devfit', database: 'ok', syncProtocol: health.syncProtocol, latencyMs: Date.now() - started,
    ...(isolated ? { loadTest: { isolated: true, projectRef } } : {}) });
}
