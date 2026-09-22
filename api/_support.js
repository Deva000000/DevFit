// Authenticated support-request operations shared by /api/data and /api/admin.
// Requests are saved first so a temporary email-provider failure cannot lose a
// customer's report. RESEND_API_KEY is server-only and optional until enabled.
import crypto from 'crypto';
import {
  getSubscriber, sbSelect, sbInsertReturning, sbPatch,
  rateLimit, clientIp, recordServerEvent
} from './_lib.js';

const SUPPORT_TO = process.env.DEVFIT_SUPPORT_TO || 'devaa1024@gmail.com';
const SUPPORT_FROM = process.env.DEVFIT_SUPPORT_FROM || 'DevFit Support <onboarding@resend.dev>';
const CATEGORIES = new Set(['feedback', 'app_issue', 'account_login', 'payment', 'training_plan']);

function cleanWhatsApp(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return raw.startsWith('+') ? '+' + digits : digits;
}

async function activeAccount(email) {
  const subscriber = await getSubscriber(email, 4000);
  if (subscriber === undefined) return { status: 503, error: 'account_service_unavailable' };
  if (!subscriber || !subscriber.approved) return { status: 403, error: 'account_unavailable' };
  return { email };
}

export async function sendSupportNotification(ticket) {
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) return { ok: false, configured: false, error: 'email_not_configured' };
  const text = [
    'New DevFit customer support request', '',
    'Category: ' + ticket.category,
    'Customer Gmail: ' + ticket.email,
    'WhatsApp: ' + ticket.whatsapp,
    'Submitted: ' + ticket.created_at,
    'Request ID: ' + ticket.id, '',
    ticket.message
  ].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'devfit-support/' + ticket.id
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to: [SUPPORT_TO],
        reply_to: ticket.email,
        subject: '[DevFit Support] ' + ticket.category.replace(/_/g, ' ') + ' · ' + ticket.email,
        text
      }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) return { ok: false, configured: true, error: String(data.message || 'email_provider_error').slice(0, 300) };
    return { ok: true, configured: true, id: String(data.id).slice(0, 200) };
  } catch (error) {
    return { ok: false, configured: true, error: String(error && error.message || 'email_provider_unavailable').slice(0, 300) };
  }
}

export async function handleSupportOperation(req, res, email, body) {
  const account = await activeAccount(email);
  if (!account.email) { res.status(account.status).json({ error: account.error }); return; }

  const strict = { failClosed: true, timeoutMs: 3000 };
  const accountKey = crypto.createHash('sha256').update(email).digest('hex');
  const [perAccount, perIp] = await Promise.all([
    rateLimit('support_submit:' + accountKey, 5, 60 * 60, strict),
    rateLimit('support_submit_ip:' + clientIp(req), 25, 60 * 60, strict)
  ]);
  if (perAccount.unavailable || perIp.unavailable) { res.status(503).json({ error: 'security_store_unavailable' }); return; }
  if (!perAccount.ok || !perIp.ok) { res.status(429).json({ error: 'support_limit_reached' }); return; }

  const category = String(body.category || 'feedback').trim().toLowerCase();
  const whatsapp = cleanWhatsApp(body.whatsapp);
  const message = String(body.message || '').trim().replace(/\r\n?/g, '\n');
  if (!CATEGORIES.has(category)) { res.status(400).json({ error: 'invalid_support_category' }); return; }
  if (!whatsapp) { res.status(400).json({ error: 'invalid_whatsapp' }); return; }
  if (message.length < 10 || message.length > 2000) { res.status(400).json({ error: 'invalid_support_message' }); return; }

  const inserted = await sbInsertReturning('devfit_support_requests', {
    id: crypto.randomUUID(), email, whatsapp, category, message,
    status: 'new', email_status: 'pending'
  });
  if (!Array.isArray(inserted) || !inserted[0]) { res.status(503).json({ error: 'support_save_failed' }); return; }

  const ticket = inserted[0];
  const delivery = await sendSupportNotification(ticket);
  const emailStatus = delivery.ok ? 'sent' : delivery.configured ? 'failed' : 'pending';
  await sbPatch('devfit_support_requests', 'id=eq.' + encodeURIComponent(ticket.id), {
    email_status: emailStatus,
    email_message_id: delivery.id || null,
    email_error: delivery.ok ? null : delivery.error,
    notified_at: delivery.ok ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  });
  if (delivery.configured && !delivery.ok) {
    await recordServerEvent('support_email', 'Support request saved but email delivery failed', {
      page: '/api/data', status: 502
    });
  }
  res.status(201).json({
    ok: true,
    id: ticket.id,
    createdAt: ticket.created_at,
    emailDelivered: delivery.ok,
    emailPending: !delivery.ok
  });
}

export async function getSupportRequest(id) {
  const rows = await sbSelect('devfit_support_requests',
    'id=eq.' + encodeURIComponent(id) + '&select=id,email,whatsapp,category,message,status,email_status,created_at&limit=1');
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
