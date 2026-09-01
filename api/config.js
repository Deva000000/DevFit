// DevFit — GET /api/config
// PUBLIC read of the trainer-editable payment settings (DuitNow QR, WhatsApp
// number, note) shown on the pricing page. No secrets here. The server uses the
// service-role key to read the single devfit_config row; writes go through the
// password-gated /api/admin (action: setConfig). Returns {} on any problem so the
// pricing page silently falls back to its built-in defaults.

import { haveServerConfig, sbSelect } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=3600');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method' });
    return;
  }
  if (!haveServerConfig()) { res.status(200).json({}); return; }
  try {
    const rows = await sbSelect('devfit_config', 'id=eq.1&select=whatsapp,price,qr,note');
    const c = (Array.isArray(rows) && rows[0]) ? rows[0] : {};
    res.status(200).json({
      whatsapp: c.whatsapp || '',
      price: c.price || '',
      qr: c.qr || '',
      note: c.note || ''
    });
  } catch (e) {
    res.status(200).json({});
  }
}
