// Payment-proof operations shared by the authenticated account-data API.
// Keeping this as an underscore-prefixed helper avoids consuming a separate
// Vercel Hobby serverless-function slot.
import crypto from 'crypto';
import {
  getSubscriber, sbSelect, sbInsertReturning, sbStorageUpload, sbStorageDelete,
  rateLimit, clientIp, recordServerEvent
} from './_lib.js';

const BUCKET = 'devfit-payment-proofs';
const MAX_BYTES = 450000;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function validImage(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_BYTES) return false;
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/webp') return bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

function paymentReference(email, when = new Date()) {
  const month = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kuala_Lumpur', month: 'short', year: '2-digit' })
    .format(when).replace(/[^a-z0-9]/gi, '').toUpperCase();
  const gmailName = String(email || '').split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 24) || 'ACCOUNT';
  return `DEVFIT_${month}_${gmailName}`;
}

async function activeAccount(email) {
  const subscriber = await getSubscriber(email, 4000);
  if (subscriber === undefined) return { status: 503, error: 'account_service_unavailable' };
  if (!subscriber || !subscriber.approved) return { status: 403, error: 'account_unavailable' };
  return { email };
}

export async function handlePaymentOperation(req, res, email, op, body) {
  const account = await activeAccount(email);
  if (!account.email) { res.status(account.status).json({ error: account.error }); return; }

  if (op === 'paymentHistory') {
    const rows = await sbSelect('devfit_payments',
      'email=eq.' + encodeURIComponent(email) + '&select=id,reference,status,byte_size,uploaded_at,reviewed_at&order=uploaded_at.desc&limit=36');
    if (!Array.isArray(rows)) { res.status(503).json({ error: 'payment_history_unavailable' }); return; }
    res.status(200).json({ reference: paymentReference(email), payments: rows });
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

  const match = String(body.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) { res.status(400).json({ error: 'invalid_image' }); return; }
  let bytes;
  try { bytes = Buffer.from(match[2], 'base64'); } catch (_) { bytes = Buffer.alloc(0); }
  const mime = match[1].toLowerCase();
  if (!validImage(bytes, mime)) { res.status(400).json({ error: bytes.length > MAX_BYTES ? 'image_too_large' : 'invalid_image' }); return; }

  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate = await sbSelect('devfit_payments',
    'email=eq.' + encodeURIComponent(email) + '&content_hash=eq.' + contentHash +
    '&select=id,reference,status,byte_size,uploaded_at,reviewed_at&limit=1');
  if (Array.isArray(duplicate) && duplicate[0]) {
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
    id, email, reference: paymentReference(email), storage_path: path,
    mime_type: mime, byte_size: bytes.length, content_hash: contentHash, status: 'pending'
  });
  if (!Array.isArray(inserted) || !inserted[0]) {
    await sbStorageDelete(BUCKET, path);
    await recordServerEvent('payment_upload', 'Receipt metadata save failed', { page: '/api/data', status: 503 });
    res.status(503).json({ error: 'payment_save_failed' }); return;
  }
  const row = inserted[0];
  res.status(201).json({ ok: true, payment: {
    id: row.id, reference: row.reference, status: row.status, byte_size: row.byte_size,
    uploaded_at: row.uploaded_at, reviewed_at: row.reviewed_at
  } });
}
