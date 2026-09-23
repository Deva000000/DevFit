// DevFit — POST /api/admin
// Owner backend for admin.html. The password is exchanged once for a short-lived
// HttpOnly cookie; normal admin actions never resend or expose the password to JS.
//
// Body: { action, ...args }
//   action 'list'                                  → { subscribers:[...] }
//   action 'get'      { email }                    → { subscriber }
//   action 'activate' { email, days=30, name, plan } → sets pro, expiry today+days
//   action 'extend'   { email, days=30 }           → adds days to current expiry
//   action 'deactivate' { email }                  → tier 'free' (data kept)
//   action 'revoke'   { email }                    → approved:false (kicked out)
//   action 'backupPage' { table, offset }          → bounded owner-backup page
//   action 'deletePreview' { email }                → exact deletion counts
//   action 'deleteAccount' { email, confirmEmail, confirmation } → permanent

import crypto from 'crypto';
import {
  haveServerConfig, sbSelect, sbUpsert, sbPatch, sbRpc, getSubscriber,
  rateLimit, clientIp, readJsonBody, listLogins, sameSiteOnly,
  signAdminSession, verifyAdminSession, cookieValue, setApiSecurityHeaders,
  sbStorageSignedUrl, sbStorageDelete, sha256Hex, recordSecurityEvent
} from './_lib.js';
import { getSupportRequest, sendSupportNotification } from './_support.js';

const ADMIN_PW = process.env.DEVFIT_ADMIN_PASSWORD || '';
const BACKUP_TABLES = {
  devfit_subscribers: 'email.asc',
  devfit_data: 'email.asc,data_type.asc',
  devfit_data_versions: 'id.asc',
  devfit_logins: 'email.asc,device_id.asc',
  devfit_payments: 'email.asc,uploaded_at.asc',
  devfit_support_requests: 'email.asc,created_at.asc',
  devfit_security_events: 'id.asc',
  devfit_security_blocks: 'created_at.asc',
  devfit_config: 'id.asc'
};
const BACKUP_PAGE_ROWS = 50;
const BACKUP_PAGE_BYTES = 2500000;

// Constant-time password check so response timing can't leak how many leading
// characters matched. Length-mismatch still returns false without comparing.
function pwOk(given) {
  try {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(ADMIN_PW);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

async function deletionCounts(email) {
  const encoded = encodeURIComponent(email);
  const results = await Promise.all([
    sbSelect('devfit_subscribers', 'email=eq.' + encoded + '&select=email'),
    sbSelect('devfit_data', 'email=eq.' + encoded + '&select=data_type'),
    sbSelect('devfit_data_versions', 'email=eq.' + encoded + '&select=id'),
    sbSelect('devfit_logins', 'email=eq.' + encoded + '&select=device_id'),
    sbSelect('devfit_records', 'email=eq.' + encoded + '&select=record_key'),
    sbSelect('devfit_payments', 'email=eq.' + encoded + '&select=id,storage_path'),
    sbSelect('devfit_support_requests', 'email=eq.' + encoded + '&select=id'),
    sbSelect('devfit_security_events', 'email=eq.' + encoded + '&select=id'),
    sbSelect('devfit_security_blocks', 'email=eq.' + encoded + '&select=id')
  ]);
  if (results.some((rows) => !Array.isArray(rows))) return null;
  return {
    subscribers: results[0].length,
    currentData: results[1].length,
    recoveryVersions: results[2].length,
    devices: results[3].length,
    records: results[4].length,
    payments: results[5].length,
    supportRequests: results[6].length,
    securityEvents: results[7].length,
    securityBlocks: results[8].length,
    paymentPaths: results[5].map((row) => row.storage_path).filter(Boolean)
  };
}

export default async function handler(req, res) {
  setApiSecurityHeaders(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!haveServerConfig() || !ADMIN_PW) { res.status(501).json({ error: 'not_configured' }); return; }

  // Admin requests are browser-only and same-origin. This is a second barrier
  // against cross-site requests in addition to SameSite=Strict on the cookie.
  if (!sameSiteOnly(req)) { res.status(403).json({ error: 'origin' }); return; }

  const body = await readJsonBody(req);
  const action = String(body.action || '');

  if (action === 'login') {
    if (!pwOk(body.password)) {
      const rl = await rateLimit('admin_fail:' + clientIp(req), 10, 15 * 60);
      // Owner login fails closed if the shared limiter is unavailable. Customer
      // login/data routes remain independent of this admin-only safeguard.
      if (rl.unavailable) { res.status(503).json({ error: 'security_store_unavailable' }); return; }
      if (!rl.ok) {
        if (!rl.currentHits || rl.currentHits === 11) {
          await recordSecurityEvent({
            ipHash: sha256Hex(clientIp(req)), type: 'admin_login_rate', severity: 'high',
            route: '/api/admin', reason: 'Repeated invalid owner-password attempts', blocked: true
          });
        }
        res.setHeader('Retry-After', String(Math.max(1, rl.retryAfter || 1)));
        res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return;
      }
      res.status(401).json({ error: 'bad_password' });
      return;
    }
    const token = signAdminSession();
    res.setHeader('Set-Cookie', 'devfit_admin_session=' + encodeURIComponent(token) +
      '; Path=/api/admin; Max-Age=43200; HttpOnly; Secure; SameSite=Strict');
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', 'devfit_admin_session=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    res.status(200).json({ ok: true });
    return;
  }

  const adminSession = verifyAdminSession(cookieValue(req, 'devfit_admin_session'));
  if (!adminSession) { res.status(401).json({ error: 'admin_session_required' }); return; }

  const email = String(body.email || '').trim().toLowerCase();

  try {
    if (action === 'list') {
      const rows = await sbSelect('devfit_subscribers', 'select=email,name,tier,approved,expiry,start_date,plan,updated_at&order=updated_at.desc');
      res.status(200).json({ subscribers: rows || [] });
      return;
    }

    if (action === 'logins') {
      // Every login/device across all users — who signed in, how many devices, when.
      res.status(200).json({ logins: await listLogins() });
      return;
    }

    if (action === 'errors') {
      const rows = await sbSelect('devfit_errors', 'select=*&order=at.desc&limit=100');
      res.status(200).json({ errors: rows || [] });
      return;
    }

    if (action === 'security') {
      const [events, blocks] = await Promise.all([
        sbSelect('devfit_security_events', 'select=id,email,device_hash,ip_hash,event_type,severity,route,reason,blocked,at&order=at.desc&limit=250'),
        sbSelect('devfit_security_blocks', 'select=id,scope,key_hash,email,reason,active,expires_at,created_at,released_at&order=created_at.desc&limit=250')
      ]);
      if (!Array.isArray(events) || !Array.isArray(blocks)) {
        res.status(503).json({ error: 'security_store_unavailable' }); return;
      }
      res.status(200).json({ events, blocks });
      return;
    }

    if (action === 'securityBlock') {
      const scope = String(body.scope || '');
      const reason = String(body.reason || '').trim().slice(0, 500);
      const blockEmail = String(body.email || '').trim().toLowerCase();
      let keyHash = String(body.keyHash || '').trim().toLowerCase();
      if (!['account', 'device', 'ip'].includes(scope) || reason.length < 3) {
        res.status(400).json({ error: 'invalid_security_block' }); return;
      }
      if (scope === 'account') {
        if (!blockEmail || blockEmail.length > 254 || !blockEmail.includes('@')) {
          res.status(400).json({ error: 'invalid_security_block' }); return;
        }
        keyHash = sha256Hex(blockEmail);
      } else if (!/^[0-9a-f]{64}$/.test(keyHash)) {
        res.status(400).json({ error: 'invalid_security_block' }); return;
      }
      const saved = await sbRpc('block_devfit_security_identity', {
        p_scope: scope, p_key_hash: keyHash, p_email: blockEmail, p_reason: reason
      });
      if (!saved) { res.status(503).json({ error: 'security_block_failed' }); return; }
      res.status(200).json({ ok: true, block: saved });
      return;
    }

    if (action === 'securityUnblock') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: 'invalid_security_block' }); return; }
      const saved = await sbPatch('devfit_security_blocks', 'id=eq.' + encodeURIComponent(id), {
        active: false, released_at: new Date().toISOString()
      });
      if (!Array.isArray(saved) || !saved[0]) { res.status(404).json({ error: 'security_block_not_found' }); return; }
      res.status(200).json({ ok: true, block: saved[0] });
      return;
    }

    if (action === 'securityResetDevices') {
      if (!email || !email.includes('@')) { res.status(400).json({ error: 'missing_email' }); return; }
      const removed = await sbRpc('reset_devfit_devices', { p_email: email });
      if (!Number.isFinite(Number(removed))) { res.status(503).json({ error: 'device_reset_failed' }); return; }
      res.status(200).json({ ok: true, removed: Number(removed) });
      return;
    }

    if (action === 'payments') {
      const rows = await sbSelect('devfit_payments',
        'select=id,email,reference,status,byte_size,uploaded_at,reviewed_at&order=uploaded_at.desc&limit=250');
      if (!Array.isArray(rows)) { res.status(503).json({ error: 'payment_history_unavailable' }); return; }
      res.status(200).json({ payments: rows });
      return;
    }

    if (action === 'paymentProof') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: 'invalid_payment' }); return; }
      const rows = await sbSelect('devfit_payments', 'id=eq.' + encodeURIComponent(id) + '&select=storage_path&limit=1');
      const path = Array.isArray(rows) && rows[0] && rows[0].storage_path;
      if (!path) { res.status(404).json({ error: 'payment_not_found' }); return; }
      const url = await sbStorageSignedUrl('devfit-payment-proofs', path, 120);
      if (!url) { res.status(503).json({ error: 'receipt_unavailable' }); return; }
      res.status(200).json({ url, expiresIn: 120 });
      return;
    }

    if (action === 'reviewPayment') {
      const id = String(body.id || '');
      const status = String(body.status || '');
      if (!/^[0-9a-f-]{36}$/i.test(id) || !['pending', 'verified', 'rejected'].includes(status)) {
        res.status(400).json({ error: 'invalid_payment_review' }); return;
      }
      const saved = await sbPatch('devfit_payments', 'id=eq.' + encodeURIComponent(id), {
        status,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        reviewed_by: status === 'pending' ? null : 'owner'
      });
      if (!Array.isArray(saved) || !saved[0]) { res.status(404).json({ error: 'payment_not_found' }); return; }
      res.status(200).json({ ok: true, payment: saved[0] });
      return;
    }

    if (action === 'support') {
      const rows = await sbSelect('devfit_support_requests',
        'select=id,email,whatsapp,category,message,status,email_status,created_at,updated_at,notified_at&order=created_at.desc&limit=250');
      if (!Array.isArray(rows)) { res.status(503).json({ error: 'support_history_unavailable' }); return; }
      res.status(200).json({ requests: rows });
      return;
    }

    if (action === 'reviewSupport') {
      const id = String(body.id || '');
      const status = String(body.status || '');
      if (!/^[0-9a-f-]{36}$/i.test(id) || !['new', 'in_progress', 'resolved'].includes(status)) {
        res.status(400).json({ error: 'invalid_support_review' }); return;
      }
      const saved = await sbPatch('devfit_support_requests', 'id=eq.' + encodeURIComponent(id), {
        status, updated_at: new Date().toISOString()
      });
      if (!Array.isArray(saved) || !saved[0]) { res.status(404).json({ error: 'support_not_found' }); return; }
      res.status(200).json({ ok: true, request: saved[0] });
      return;
    }

    if (action === 'notifySupport') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: 'invalid_support_request' }); return; }
      const ticket = await getSupportRequest(id);
      if (!ticket) { res.status(404).json({ error: 'support_not_found' }); return; }
      const delivery = await sendSupportNotification(ticket);
      const emailStatus = delivery.ok ? 'sent' : delivery.configured ? 'failed' : 'pending';
      await sbPatch('devfit_support_requests', 'id=eq.' + encodeURIComponent(id), {
        email_status: emailStatus,
        email_message_id: delivery.id || null,
        email_error: delivery.ok ? null : delivery.error,
        notified_at: delivery.ok ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      });
      res.status(delivery.ok ? 200 : 503).json({ ok: delivery.ok, error: delivery.ok ? undefined : delivery.error });
      return;
    }

    // Password-gated, whitelisted and paged. The server never accepts an
    // arbitrary table name, and the admin page encrypts every page into one
    // off-site backup before it is downloaded.
    if (action === 'backupPage') {
      const table = String(body.table || '');
      const order = BACKUP_TABLES[table];
      if (!order) { res.status(400).json({ error: 'bad_backup_table' }); return; }
      const offset = Math.max(0, Math.min(parseInt(body.offset || '0', 10) || 0, 10000000));
      const rows = await sbSelect(table,
        'select=*&order=' + encodeURIComponent(order) + '&offset=' + offset + '&limit=' + BACKUP_PAGE_ROWS);
      if (!Array.isArray(rows)) { res.status(503).json({ error: 'backup_store_unavailable' }); return; }
      const page = [];
      let bytes = 2;
      for (const row of rows) {
        const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
        if (page.length && bytes + rowBytes > BACKUP_PAGE_BYTES) break;
        page.push(row);
        bytes += rowBytes;
      }
      const consumed = page.length;
      res.status(200).json({
        table,
        rows: page,
        nextOffset: offset + consumed,
        done: consumed === rows.length && rows.length < BACKUP_PAGE_ROWS
      });
      return;
    }

    if (action === 'deletePreview') {
      if (!email || !email.includes('@')) { res.status(400).json({ error: 'missing_email' }); return; }
      const counts = await deletionCounts(email);
      if (!counts) { res.status(503).json({ error: 'account_store_unavailable' }); return; }
      const publicCounts = { ...counts }; delete publicCounts.paymentPaths;
      res.status(200).json({ email, counts: publicCounts });
      return;
    }

    if (action === 'deleteAccount') {
      const confirmEmail = String(body.confirmEmail || '').trim().toLowerCase();
      const confirmation = String(body.confirmation || '').trim();
      if (!email || !email.includes('@') || confirmEmail !== email || confirmation !== 'DELETE DEVFIT ACCOUNT') {
        res.status(400).json({ error: 'deletion_confirmation_mismatch' }); return;
      }
      const rl = await rateLimit('admin_delete:' + clientIp(req), 10, 24 * 60 * 60);
      if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return; }
      const counts = await deletionCounts(email);
      if (!counts) { res.status(503).json({ error: 'account_store_unavailable' }); return; }
      if (counts.paymentPaths.length && !(await sbStorageDelete('devfit-payment-proofs', counts.paymentPaths))) {
        res.status(503).json({ error: 'payment_proof_delete_failed' }); return;
      }
      const deleted = await sbRpc('delete_devfit_account', { p_email: email });
      if (!deleted || deleted.email !== email) { res.status(500).json({ error: 'delete_failed' }); return; }
      const remaining = await deletionCounts(email);
      if (!remaining || ['subscribers','currentData','recoveryVersions','devices','records','payments','supportRequests','securityEvents','securityBlocks']
        .some((key) => remaining[key] !== 0)) {
        res.status(500).json({ error: 'delete_verification_failed', remaining }); return;
      }
      delete remaining.paymentPaths;
      res.status(200).json({ ok: true, deleted, remaining });
      return;
    }

    // ── Payment settings (DuitNow QR / WhatsApp / note) — trainer-editable ──
    if (action === 'getConfig') {
      const rows = await sbSelect('devfit_config', 'id=eq.1&select=*');
      res.status(200).json({ config: (Array.isArray(rows) && rows[0]) || {} });
      return;
    }
    if (action === 'setConfig') {
      const row = { id: 1, updated_at: new Date().toISOString() };
      if (typeof body.whatsapp === 'string') row.whatsapp = body.whatsapp.replace(/[^0-9]/g, '').slice(0, 20);
      if (typeof body.price === 'string') row.price = body.price.replace(/[^0-9.RM ]/gi, '').slice(0, 20);
      if (typeof body.qr === 'string') {
        const qr = body.qr.trim();
        if (qr && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(qr) && !/^\/(?!\/)[a-z0-9_./-]+$/i.test(qr)) {
          res.status(400).json({ error: 'invalid_qr_image' }); return;
        }
        row.qr = qr.slice(0, 500000);
      }
      if (typeof body.note === 'string') row.note = body.note.slice(0, 500);
      const saved = await sbUpsert('devfit_config', row, 'id');
      if (!saved) { res.status(500).json({ error: 'save_failed' }); return; }
      res.status(200).json({ ok: true, config: Array.isArray(saved) ? saved[0] : saved });
      return;
    }

    if (action === 'get') {
      if (!email) { res.status(400).json({ error: 'missing_email' }); return; }
      res.status(200).json({ subscriber: await getSubscriber(email) });
      return;
    }

    if (!email || !email.includes('@')) { res.status(400).json({ error: 'missing_email' }); return; }
    const existing = await getSubscriber(email);
    const now = new Date();

    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s));

    let row;
    if (action === 'activate') {
      // Calendar window the trainer picks. start_date = first day of access,
      // expiry = last day of access (inclusive). Falls back to days if no end.
      let start = String(body.start || '').slice(0, 10);
      let end = String(body.end || '').slice(0, 10);
      if (!isDate(start)) start = ymd(now);
      if (!isDate(end)) {
        const days = Math.max(1, parseInt(body.days || '30', 10) || 30);
        end = ymd(addDays(new Date(start), days - 1)); // inclusive span
      }
      if (new Date(end) < new Date(start)) { res.status(400).json({ error: 'end_before_start' }); return; }
      row = {
        email,
        name: body.name || (existing && existing.name) || email.split('@')[0],
        tier: 'pro',
        approved: true,
        start_date: start,
        expiry: end,
        plan: body.plan || (existing && existing.plan) || 'Pro',
        updated_at: now.toISOString()
      };
    } else if (action === 'extend') {
      const days = Math.max(1, parseInt(body.days || '30', 10) || 30);
      const base = (existing && existing.expiry && new Date(existing.expiry) > now) ? new Date(existing.expiry) : now;
      row = {
        email,
        name: (existing && existing.name) || email.split('@')[0],
        tier: 'pro', approved: true,
        expiry: ymd(addDays(base, days)),
        start_date: (existing && existing.start_date) || ymd(now),
        plan: (existing && existing.plan) || 'Pro',
        updated_at: now.toISOString()
      };
    } else if (action === 'deactivate') {
      row = { email, tier: 'free', approved: true, updated_at: now.toISOString() };
    } else if (action === 'revoke') {
      row = { email, approved: false, tier: 'free', updated_at: now.toISOString() };
    } else {
      res.status(400).json({ error: 'unknown_action' });
      return;
    }

    const saved = await sbUpsert('devfit_subscribers', row, 'email');
    if (!saved) { res.status(500).json({ error: 'save_failed' }); return; }
    res.status(200).json({ ok: true, subscriber: Array.isArray(saved) ? saved[0] : saved });
  } catch (e) {
    console.error('[DevFit admin]', String(e && e.message || e));
    res.status(500).json({ error: 'server_error' });
  }
}
