// Public, non-sensitive production health probe for automated monitoring.
import { haveServerConfig, sbRpc, SB_URL } from './_lib.js';
let snapshot = null;
let snapshotUntil = 0;
let pending = null;

async function probe() {
  if (snapshot && snapshotUntil > Date.now()) return snapshot;
  if (!pending) pending = (async () => {
    const started = Date.now();
    const health = await sbRpc('devfit_sync_health', {}, 8000);
    snapshot = { health, latencyMs: Date.now() - started };
    snapshotUntil = Date.now() + (health?.ok ? 15000 : 3000);
    return snapshot;
  })().finally(() => { pending = null; });
  return pending;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  // Public, non-personal status only. CDN cache + coalesced warm-instance probe
  // prevents every anonymous poll becoming another database request.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'method' });
    return;
  }
  if (!haveServerConfig()) {
    res.status(503).json({ ok: false, service: 'devfit', database: 'not_configured' });
    return;
  }
  const { health, latencyMs } = await probe();
  if (!health || health.ok !== true) {
    res.status(503).json({ ok: false, service: 'devfit', database: 'unavailable' });
    return;
  }
  const projectRef = new URL(SB_URL).hostname.split('.')[0];
  const isolated = process.env.DEVFIT_ENVIRONMENT === 'staging'
    && projectRef !== 'zngberygrzpkhiqrrzwj'
    && projectRef === process.env.DEVFIT_LOAD_PROJECT_REF;
  res.status(200).json({ ok: true, service: 'devfit', database: 'ok', syncProtocol: health.syncProtocol, latencyMs,
    ...(isolated ? { loadTest: { isolated: true, projectRef } } : {}) });
}
