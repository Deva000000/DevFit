// Payment-proof operations shared by the authenticated account-data API.
// Keeping this as an underscore-prefixed helper avoids consuming a separate
// Vercel Hobby serverless-function slot.
import crypto from 'crypto';
import {
  getSubscriber, sbSelect, sbInsertReturning, sbStorageUpload, sbStorageDelete,
  sbPatch, rateLimit, clientIp, recordServerEvent
} from './_lib.js';

const BUCKET = 'devfit-payment-proofs';
const MAX_BYTES = 450000;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const COACHING_OFFERS = Object.freeze({
  coaching_4w: { label: 'Coaching · 4 weeks', amountCents: 20000, referenceCode: 'C4' },
  coaching_8w: { label: 'Coaching · 8 weeks', amountCents: 36000, referenceCode: 'C8' },
  coaching_12w: { label: 'Coaching · 12 weeks', amountCents: 50000, referenceCode: 'C12' },
  coaching_student_4w: { label: 'Student coaching · 4 weeks', amountCents: 16000, referenceCode: 'STU4' }
});

function appPriceCents(raw) {
  const match = String(raw || '').trim().match(/^(?:RM\s*)?(\d{1,4})(?:\.(\d{1,2}))?$/i);
  if (!match) return 1990;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 && cents <= 1000000 ? cents : 1990;
}

export async function paymentOffers() {
  const rows = await sbSelect('devfit_config', 'id=eq.1&select=price,whatsapp&limit=1', 4000);
  if (!Array.isArray(rows) || !rows[0]) return null;
  const config = rows[0];
  return {
    offers: [{ code: 'app_pro', label: 'DevFit Pro app · 30 days', amountCents: appPriceCents(config.price) },
      ...Object.entries(COACHING_OFFERS).map(([code, offer]) => ({ code, label: offer.label, amountCents: offer.amountCents }))],
    ownerWhatsapp: String(config.whatsapp || '60183679177').replace(/\D/g, '').slice(0, 15)
  };
}

function cleanWhatsApp(value) {
  const raw = String(value || '').trim();
  if (!/^\+?[0-9\s()-]{7,24}$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? (raw.startsWith('+') ? '+' : '') + digits : '';
}

function cleanName(value) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}

export async function sendPaymentNotification(payment) {
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) return { ok: false, configured: false, error: 'email_not_configured' };
  const offer = COACHING_OFFERS[payment.offer_code];
  const label = offer ? offer.label : 'DevFit Pro app · 30 days';
  const amount = payment.expected_amount_cents ? 'RM' + (payment.expected_amount_cents / 100).toFixed(2) : 'Not recorded';
  const body = [
    'New DevFit receipt awaiting your review', '',
    'Package: ' + label,
    'Listed amount: ' + amount,
    'Name: ' + (payment.payer_name || 'Not supplied'),
    'Gmail: ' + payment.email,
    'WhatsApp: ' + (payment.payer_whatsapp || 'Not supplied'),
    'Payment reference: ' + payment.reference,
    'Uploaded: ' + payment.uploaded_at,
    'Receipt ID: ' + payment.id, '',
    'Open https://devfitportal.vercel.app/admin.html → Payments to view the private receipt and check the actual amount. No access was activated.'
  ].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
        'Idempotency-Key': 'devfit-payment/' + payment.id },
      body: JSON.stringify({
        from: process.env.DEVFIT_SUPPORT_FROM || 'DevFit Support <onboarding@resend.dev>',
        to: [process.env.DEVFIT_SUPPORT_TO || 'devaa1024@gmail.com'],
        subject: '[DevFit Payment] ' + label + ' · ' + payment.email,
        text: body
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

export async function notifySavedPayment(payment) {
  const delivery = await sendPaymentNotification(payment);
  const tracked = await sbPatch('devfit_payments', 'id=eq.' + encodeURIComponent(payment.id), {
    email_status: delivery.ok ? 'sent' : delivery.configured ? 'failed' : 'pending',
    email_error: delivery.ok ? null : delivery.error,
    notified_at: delivery.ok ? new Date().toISOString() : null
  });
  if (!tracked) await recordServerEvent('payment_email', 'Receipt saved but notification status could not be recorded', {
    page: '/api/data', status: 503
  });
  if (delivery.configured && !delivery.ok) {
    await recordServerEvent('payment_email', 'Receipt saved but owner email delivery failed', {
      page: '/api/data', status: 502
    });
  }
  return delivery;
}

function validImage(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_BYTES) return false;
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/webp') return bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

function paymentReference(email, offerCode = 'app_pro', when = new Date()) {
  const month = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kuala_Lumpur', month: 'short', year: '2-digit' })
    .format(when).replace(/[^a-z0-9]/gi, '').toUpperCase();
  const gmailName = String(email || '').split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 24) || 'ACCOUNT';
  const suffix = offerCode === 'app_pro' ? 'APP' : COACHING_OFFERS[offerCode]?.referenceCode || 'APP';
  return `DEVFIT_${month}_${gmailName}_${suffix}`;
}

async function activeAccount(email) {
  const subscriber = await getSubscriber(email, 4000);
  if (subscriber === undefined) return { status: 503, error: 'account_service_unavailable' };
  if (!subscriber || !subscriber.approved) return { status: 403, error: 'account_unavailable' };
  return { email, subscriber };
}

export async function handlePaymentOperation(req, res, email, op, body) {
  const account = await activeAccount(email);
  if (!account.email) { res.status(account.status).json({ error: account.error }); return; }

  if (op === 'paymentHistory') {
    const rows = await sbSelect('devfit_payments',
      'email=eq.' + encodeURIComponent(email) + '&select=id,reference,offer_code,expected_amount_cents,status,byte_size,uploaded_at,reviewed_at&order=uploaded_at.desc&limit=36');
    if (!Array.isArray(rows)) { res.status(503).json({ error: 'payment_history_unavailable' }); return; }
    const catalog = await paymentOffers();
    if (!catalog) { res.status(503).json({ error: 'payment_settings_unavailable' }); return; }
    res.status(200).json({ email, reference: paymentReference(email), payments: rows, ...catalog });
    return;
  }

  if (op !== 'submitPayment') { res.status(400).json({ error: 'unknown_payment_op' }); return; }

  const strict = { failClosed: true, timeoutMs: 3000 };
  const accountKey = crypto.createHash('sha256').update(email).digest('hex');
  const [perAccount, perIp] = await Promise.all([
    rateLimit('payment_upload:' + accountKey, 8, 24 * 60 * 60, strict),
    rateLimit('payment_upload_ip:' + clientIp(req), 50, 24 * 60 * 60, strict)
  ]);
  if (perAccount.unavailable || perIp.unavailable) { res.status(503).json({ error: 'security_store_unavailable' }); return; }
  if (!perAccount.ok || !perIp.ok) { res.status(429).json({ error: 'upload_limit_reached' }); return; }

  const offerCode = String(body.offerCode || 'app_pro');
  const catalog = await paymentOffers();
  if (!catalog) { res.status(503).json({ error: 'payment_settings_unavailable' }); return; }
  const selectedOffer = catalog.offers.find((offer) => offer.code === offerCode);
  if (!selectedOffer) { res.status(400).json({ error: 'invalid_offer' }); return; }
  if (body.payerEmail && String(body.payerEmail).trim().toLowerCase() !== email) {
    res.status(400).json({ error: 'email_mismatch' }); return;
  }
  const payerName = cleanName(body.payerName || (!body.offerCode && account.subscriber.name) || '');
  const payerWhatsApp = cleanWhatsApp(body.payerWhatsApp);
  if (body.offerCode && (payerName.length < 2 || !payerWhatsApp)) {
    res.status(400).json({ error: 'invalid_payment_details' }); return;
  }

  const match = String(body.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) { res.status(400).json({ error: 'invalid_image' }); return; }
  let bytes;
  try { bytes = Buffer.from(match[2], 'base64'); } catch (_) { bytes = Buffer.alloc(0); }
  const mime = match[1].toLowerCase();
  if (!validImage(bytes, mime)) { res.status(400).json({ error: bytes.length > MAX_BYTES ? 'image_too_large' : 'invalid_image' }); return; }

  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate = await sbSelect('devfit_payments',
    'email=eq.' + encodeURIComponent(email) + '&content_hash=eq.' + contentHash +
    '&select=id,reference,offer_code,status,byte_size,uploaded_at,reviewed_at&limit=1');
  if (Array.isArray(duplicate) && duplicate[0]) {
    if (duplicate[0].offer_code && duplicate[0].offer_code !== offerCode) {
      res.status(409).json({ error: 'receipt_already_used_for_another_offer' }); return;
    }
    res.status(200).json({ ok: true, duplicate: true, payment: duplicate[0] }); return;
  }

  const id = crypto.randomUUID();
  const ownerFolder = accountKey.slice(0, 24);
  const path = ownerFolder + '/' + id + '.' + MIME_EXT[mime];
  if (!(await sbStorageUpload(BUCKET, path, bytes, mime))) {
    await recordServerEvent('payment_upload', 'Receipt storage upload failed', { page: '/api/data', status: 503 });
    res.status(503).json({ error: 'receipt_storage_unavailable' }); return;
  }

  const inserted = await sbInsertReturning('devfit_payments', {
    id, email, reference: paymentReference(email, offerCode), storage_path: path,
    mime_type: mime, byte_size: bytes.length, content_hash: contentHash, status: 'pending',
    offer_code: offerCode, payer_name: payerName || null, payer_whatsapp: payerWhatsApp || null,
    expected_amount_cents: selectedOffer.amountCents
  });
  if (!Array.isArray(inserted) || !inserted[0]) {
    await sbStorageDelete(BUCKET, path);
    await recordServerEvent('payment_upload', 'Receipt metadata save failed', { page: '/api/data', status: 503 });
    res.status(503).json({ error: 'payment_save_failed' }); return;
  }
  const row = inserted[0];
  const notification = await notifySavedPayment(row);
  res.status(201).json({ ok: true, payment: {
    id: row.id, reference: row.reference, offer_code: row.offer_code,
    expected_amount_cents: row.expected_amount_cents, status: row.status, byte_size: row.byte_size,
    uploaded_at: row.uploaded_at, reviewed_at: row.reviewed_at
  }, emailDelivered: notification.ok, emailPending: !notification.ok,
  ownerWhatsapp: catalog.ownerWhatsapp });
}
