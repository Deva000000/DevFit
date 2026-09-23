// DevFit — authenticated account-data API.
// Identity is derived only from the server-signed token. Reads and writes use
// security-definer RPCs that authorize the account inside the same transaction.

import crypto from 'crypto';
import {
  haveServerConfig, verifyToken, sbRpc, readJsonBody, recordServerEvent,
  clientIp, bearerToken, setApiSecurityHeaders, sameOriginIfPresent,
  checkSecurityAccess, tokenDeviceMatches, guardInvalidAuth, recordDeviceMismatch
} from './_lib.js';
import { handlePaymentOperation } from './_payments.js';
import { handleSupportOperation } from './_support.js';

const TYPES = ['progress', 'nutrition', 'workouts', 'prefs'];
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

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameOriginIfPresent(req)) { res.status(403).json({ error: 'origin' }); return; }
  if (!haveServerConfig()) { res.status(501).json({ error: 'not_configured' }); return; }

  const body = await readJsonBody(req);
  // Authorization is the current contract. Body fallback keeps already-installed
  // PWAs working during the staggered service-worker rollout.
  const payload = verifyToken(bearerToken(req) || body.token);
  if (!payload || !payload.email) {
    const invalid = await guardInvalidAuth(req, '/api/data');
    if (invalid.blocked) res.setHeader('Retry-After', String(invalid.retryAfter));
    res.status(invalid.blocked ? (invalid.unavailable ? 503 : 429) : 401)
      .json({ error: invalid.blocked ? (invalid.unavailable ? 'service_unavailable' : 'rate_limited') : 'invalid_token' });
    return;
  }
  const email = String(payload.email).trim().toLowerCase();
  const op = String(body.op || '');

  // Existing signed sessions are accepted during rollout, then /api/verify
  // replaces them with a device-bound token. Bound tokens cannot be replayed
  // from a different browser installation.
  if (payload.did) {
    if (!tokenDeviceMatches(payload, body.deviceId)) {
      await recordDeviceMismatch(req, email, body.deviceId, '/api/data');
      res.status(401).json({ error: 'invalid_device' }); return;
    }
    const security = await checkSecurityAccess(req, email, body.deviceId, {
      route: '/api/data', requireKnown: true
    });
    if (security.status === 'unavailable') { res.status(503).json({ error: 'security_store_unavailable' }); return; }
    if (security.status !== 'ok') { res.status(403).json({ error: security.status }); return; }
  }

  try {
    if (op === 'paymentHistory' || op === 'submitPayment') {
      await handlePaymentOperation(req, res, email, op, body);
      return;
    }

    if (op === 'submitSupport') {
      await handleSupportOperation(req, res, email, body);
      return;
    }

    if (op === 'get') {
      const dataType = body.dataType == null || body.dataType === '' ? null : String(body.dataType);
      if (dataType !== null && TYPES.indexOf(dataType) < 0) {
        res.status(400).json({ error: 'bad_type' }); return;
      }
      const result = await sbRpc('load_devfit_account', { p_email: email, p_data_type: dataType }, 8000);
      if (!result) { res.status(503).json({ error: 'account_data_unavailable' }); return; }
      if (result.status === 'revoked') { res.status(403).json({ error: 'revoked' }); return; }
      if (result.status !== 'ok') { res.status(400).json({ error: 'invalid_request' }); return; }
      res.status(200).json({ rows: Array.isArray(result.rows) ? result.rows : [] });
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

      const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex');
      const result = await sbRpc('save_devfit_data_atomic', {
        p_email: email,
        p_data_type: dataType,
        p_data: body.data,
        p_base_updated_at: String(body.baseUpdatedAt || ''),
        p_device_id: String(body.deviceId || 'unknown').slice(0, 80),
        p_ip_hash: ipHash
      }, 12000);

      if (!result) {
        await recordServerEvent('data_failure', 'Atomic account save unavailable', { page: '/api/data', status: 503 });
        res.status(503).json({ error: 'save_unavailable' }); return;
      }
      if (result.status === 'conflict') {
        res.status(409).json({ error: 'conflict', row: result.row || null }); return;
      }
      if (result.status === 'rate_limited') {
        const retryAfter = Math.max(1, Number(result.retryAfter) || 1);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'rate_limited', retryAfter }); return;
      }
      if (result.status === 'revoked') { res.status(403).json({ error: 'revoked' }); return; }
      if (result.status === 'too_large') { res.status(413).json({ error: 'data_too_large' }); return; }
      if (result.status !== 'ok') { res.status(400).json({ error: 'invalid_request' }); return; }

      res.status(200).json({
        ok: true,
        unchanged: result.unchanged === true,
        updated_at: result.updated_at || ''
      });
      return;
    }

    res.status(400).json({ error: 'unknown_op' });
  } catch (e) {
    await recordServerEvent('data_failure', 'Unhandled account-data failure', {
      page: '/api/data', status: 500, stack: e && e.stack
    });
    res.status(500).json({ error: 'server_error' });
  }
}
