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

import crypto from 'crypto';
import {
  haveServerConfig, verifyToken, sbSelect, sbInsert, sbInsertReturning, sbPatch, readJsonBody
} from './_lib.js';

const TYPES = ['progress', 'nutrition', 'workouts', 'prefs'];

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function contentHash(data) {
  return crypto.createHash('sha256').update(stableJson(data)).digest('hex');
}

async function archiveVersion(email, dataType, data, deviceId) {
  // Best effort during rollout: a missing history table must not stop the current
  // row being saved. Once SETUP_AUTH's additive migration is run, every distinct
  // accepted state is retained and can be recovered by the trainer.
  await sbInsert('devfit_data_versions', {
    email,
    data_type: dataType,
    data,
    content_hash: contentHash(data),
    source_device: String(deviceId || 'unknown').slice(0, 80)
  });
}

async function currentRow(email, dataType) {
  const rows = await sbSelect(
    'devfit_data',
    'email=eq.' + encodeURIComponent(email) +
      '&data_type=eq.' + encodeURIComponent(dataType) +
      '&select=data_type,data,updated_at'
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

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
      const existing = await currentRow(email, dataType);
      const baseUpdatedAt = String(body.baseUpdatedAt || '');
      const now = new Date().toISOString();

      if (existing) {
        // Optimistic concurrency: a device may only replace the exact version it
        // previously read. A stale device receives the current document, merges
        // it locally, then retries. It can never silently overwrite newer data.
        if (!baseUpdatedAt || baseUpdatedAt !== String(existing.updated_at || '')) {
          res.status(409).json({ error: 'conflict', row: existing });
          return;
        }
        await archiveVersion(email, dataType, existing.data, 'server-before:' + String(body.deviceId || 'unknown'));
        const changed = await sbPatch(
          'devfit_data',
          'email=eq.' + encodeURIComponent(email) +
            '&data_type=eq.' + encodeURIComponent(dataType) +
            '&updated_at=eq.' + encodeURIComponent(baseUpdatedAt),
          { data: body.data, updated_at: now }
        );
        if (!changed) { res.status(500).json({ error: 'save_failed' }); return; }
        if (!changed.length) {
          res.status(409).json({ error: 'conflict', row: await currentRow(email, dataType) });
          return;
        }
        await archiveVersion(email, dataType, body.data, body.deviceId);
        res.status(200).json({ ok: true, updated_at: changed[0].updated_at || now });
        return;
      }

      const inserted = await sbInsertReturning('devfit_data', {
        email, data_type: dataType, data: body.data, updated_at: now
      });
      if (!inserted || !inserted.length) {
        const raced = await currentRow(email, dataType);
        if (raced) { res.status(409).json({ error: 'conflict', row: raced }); return; }
        res.status(500).json({ error: 'save_failed' }); return;
      }
      await archiveVersion(email, dataType, body.data, body.deviceId);
      res.status(200).json({ ok: true, updated_at: inserted[0].updated_at || now });
      return;
    }

    res.status(400).json({ error: 'unknown_op' });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
}
