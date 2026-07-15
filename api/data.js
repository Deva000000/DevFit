// DevFit — POST /api/data
// Token-authenticated cloud data store. The email is taken from the SIGNED
// session token (verified server-side), NEVER from the client body — so a user
// can only ever read or write their OWN row. This replaces the browser talking
// to Supabase directly with the public anon key (which had no row-level security,
// letting anyone read/overwrite any email's data).
//
// The service-role key (server-only) is what actually touches the table, so the
// table itself can — and must — deny the public anon key entirely (see SETUP_AUTH).
//
// Body: { token, op:'get' }                 → { rows:[{data_type,data,updated_at}] }
//       { token, op:'set', dataType, data } → { ok:true, updated_at }

import {
  haveServerConfig, verifyToken, sbSelect, sbUpsert, readJsonBody
} from './_lib.js';

const TYPES = ['progress', 'nutrition', 'workouts'];

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // Not configured yet → 501 so the client degrades gracefully (local-only) and
  // no one is locked out or loses data.
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);

  // Identity comes ONLY from the signed token. A forged/absent token is rejected.
  const payload = verifyToken(body.token);
  if (!payload || !payload.email) { res.status(401).json({ error: 'invalid_token' }); return; }
  const email = String(payload.email).toLowerCase();

  const op = String(body.op || '');
  try {
    if (op === 'get') {
      const rows = await sbSelect(
        'devfit_data',
        'email=eq.' + encodeURIComponent(email) + '&select=data_type,data,updated_at'
      );
      res.status(200).json({ rows: rows || [] });
      return;
    }

    if (op === 'set') {
      const dataType = String(body.dataType || '');
      if (TYPES.indexOf(dataType) < 0) { res.status(400).json({ error: 'bad_type' }); return; }
      if (typeof body.data === 'undefined') { res.status(400).json({ error: 'no_data' }); return; }
      const saved = await sbUpsert(
        'devfit_data',
        { email, data_type: dataType, data: body.data, updated_at: new Date().toISOString() },
        'email,data_type'
      );
      if (!saved) { res.status(500).json({ error: 'save_failed' }); return; }
      const row = Array.isArray(saved) ? saved[0] : saved;
      res.status(200).json({ ok: true, updated_at: (row && row.updated_at) || new Date().toISOString() });
      return;
    }

    res.status(400).json({ error: 'unknown_op' });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
}
