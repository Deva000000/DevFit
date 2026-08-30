// Public, non-sensitive production health probe for automated monitoring.
import { haveServerConfig, sbSelect } from './_lib.js';

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
  const rows = await sbSelect('devfit_config', 'select=id&limit=1');
  if (!Array.isArray(rows)) {
    res.status(503).json({ ok: false, service: 'devfit', database: 'unavailable' });
    return;
  }
  res.status(200).json({ ok: true, service: 'devfit', database: 'ok', latencyMs: Date.now() - started });
}
