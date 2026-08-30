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
  haveServerConfig, verifyToken, getSubscriber, sbSelect, sbInsertIgnore, sbInsertReturning, sbPatch, sbRpc,
  readJsonBody, recordServerEvent, rateLimit, clientIp
} from './_lib.js';

const TYPES = ['progress', 'nutrition', 'workouts', 'prefs'];
// These are far above current production documents, but below the point where
// one account can monopolise a free database or overflow browser localStorage.
const MAX_DATA_BYTES = {
  progress: 512 * 1024,
  nutrition: 768 * 1024,
  workouts: 1024 * 1024,
  prefs: 64 * 1024
};

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function contentHash(data) {
  return crypto.createHash('sha256').update(stableJson(data)).digest('hex');
}

async function archiveVersion(email, dataType, data, deviceId) {
  const snapshot = {
    email,
    data_type: dataType,
    data,
    content_hash: contentHash(data),
    source_device: String(deviceId || 'unknown').slice(0, 80)
  };
  // The RPC de-duplicates, rate-spaces and retains the latest eight recovery
  // snapshots per document. If code and schema deploy a few seconds apart, the
  // conflict-safe insert remains a non-blocking fallback.
  const archived = await sbRpc('archive_devfit_data_version', {
    p_email: snapshot.email,
    p_data_type: snapshot.data_type,
    p_data: snapshot.data,
    p_content_hash: snapshot.content_hash,
    p_source_device: snapshot.source_device
  });
  if (archived === null) {
    await sbInsertIgnore('devfit_data_versions', snapshot, 'email,data_type,content_hash');
  }
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

  // Persistent sessions must stop working immediately when the trainer revokes
  // an account. Check the authoritative subscriber row for data calls too, not
  // only during page-load verification.
  const subscriber = await getSubscriber(email);
  if (typeof subscriber === 'undefined') { res.status(503).json({ error: 'account_store_unavailable' }); return; }
  if (!subscriber || !subscriber.approved) { res.status(403).json({ error: 'revoked' }); return; }

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
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        res.status(400).json({ error: 'bad_data' }); return;
      }
      const bytes = Buffer.byteLength(stableJson(body.data), 'utf8');
      if (bytes > MAX_DATA_BYTES[dataType]) {
        res.status(413).json({ error: 'data_too_large', maxBytes: MAX_DATA_BYTES[dataType] }); return;
      }

      // Normal UI use stays far below these ceilings. Both account and IP limits
      // are required because verified Google signup is open to free users.
      const accountKey = crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
      const [accountRate, ipRate] = await Promise.all([
        rateLimit('data_user:' + accountKey, 300, 60 * 60),
        rateLimit('data_ip:' + clientIp(req), 600, 60 * 60)
      ]);
      if (!accountRate.ok || !ipRate.ok) {
        const retryAfter = Math.max(accountRate.retryAfter || 0, ipRate.retryAfter || 0, 1);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'rate_limited', retryAfter }); return;
      }

      const existing = await currentRow(email, dataType);
      const baseUpdatedAt = String(body.baseUpdatedAt || '');
      const now = new Date().toISOString();

      if (existing) {
        // Page loads and cross-device reconciliation often offer the exact state
        // already stored. A semantic no-op must not update timestamps or grow the
        // recovery table, even if the caller's base version is stale.
        if (contentHash(existing.data) === contentHash(body.data)) {
          res.status(200).json({ ok: true, unchanged: true, updated_at: existing.updated_at });
          return;
        }
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
        if (!changed) {
          await recordServerEvent('data_failure', 'Account data update failed', { page: '/api/data', status: 500 });
          res.status(500).json({ error: 'save_failed' }); return;
        }
        if (!changed.length) {
          res.status(409).json({ error: 'conflict', row: await currentRow(email, dataType) });
          return;
        }
        res.status(200).json({ ok: true, updated_at: changed[0].updated_at || now });
        return;
      }

      const inserted = await sbInsertReturning('devfit_data', {
        email, data_type: dataType, data: body.data, updated_at: now
      });
      if (!inserted || !inserted.length) {
        const raced = await currentRow(email, dataType);
        if (raced) { res.status(409).json({ error: 'conflict', row: raced }); return; }
        await recordServerEvent('data_failure', 'Account data insert failed', { page: '/api/data', status: 500 });
        res.status(500).json({ error: 'save_failed' }); return;
      }
      res.status(200).json({ ok: true, updated_at: inserted[0].updated_at || now });
      return;
    }

    res.status(400).json({ error: 'unknown_op' });
  } catch (e) {
    await recordServerEvent('data_failure', String(e && e.message || e), { page: '/api/data', status: 500, stack: e && e.stack });
    res.status(500).json({ error: 'server_error' });
  }
}
