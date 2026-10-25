// Private scheduled worker. Job credentials authorize only bounded delivery of
// existing owner notifications, never admin actions, exports or Pro activation.
import { sbRpc, sbSelect, recordServerEvent } from './_lib.js';
import { sendPaymentNotification } from './_payments.js';
import { sendSupportNotification } from './_support.js';

export async function runNotificationWorker(req, res) {
  const token = String(req.headers?.['x-devfit-job'] || '');
  if (req.headers?.origin || req.headers?.cookie || !/^[0-9a-f]{64}$/.test(token)) {
    res.status(401).json({ error: 'job_unauthorized' }); return;
  }
  const claimed = await sbRpc('claim_devfit_notifications', { p_job_token: token }, 4000);
  if (!claimed) { res.status(503).json({ error: 'job_store_unavailable' }); return; }
  if (claimed.status !== 'ok') { res.status(401).json({ error: 'job_unauthorized' }); return; }
  if (!Array.isArray(claimed.jobs) || claimed.jobs.length > 2) {
    res.status(503).json({ error: 'invalid_job_batch' }); return;
  }
  let sent = 0, pending = 0;
  for (const job of claimed.jobs) {
    const payment = !!job.payment_id;
    const rows = await sbSelect(payment ? 'devfit_payments' : 'devfit_support_requests',
      'id=eq.' + encodeURIComponent(payment ? job.payment_id : job.support_id) +
      '&select=' + (payment
        ? 'id,email,reference,offer_code,expected_amount_cents,payer_name,payer_whatsapp,uploaded_at,email_status'
        : 'id,email,whatsapp,category,message,created_at,email_status') + '&limit=1', 4000);
    // A DB outage leaves the lease for a later retry. Missing/deleted rows cannot
    // be substituted with caller-supplied content or a different recipient.
    if (!Array.isArray(rows) || !rows[0]) { pending++; continue; }
    const delivery = rows[0].email_status === 'sent' ? { ok: true }
      : await (payment ? sendPaymentNotification(rows[0]) : sendSupportNotification(rows[0]));
    const completed = await sbRpc('finish_devfit_notification', {
      p_id: job.id, p_lease_id: job.lease_id, p_ok: delivery.ok === true,
      p_message_id: delivery.id || null,
      // Do not put provider response bodies or customer details in job logs.
      p_error: delivery.ok ? null : delivery.configured ? 'email_provider_unavailable' : 'email_not_configured'
    }, 4000);
    if (completed?.status === 'sent') sent++; else pending++;
    if (completed?.status === 'exhausted') await recordServerEvent('notification_retry',
      'Owner notification needs manual review after automatic retries', { page: '/api/admin', status: 503 });
  }
  // Counts only: no customer Gmail, ticket message, receipt URL or credential.
  res.status(200).json({ ok: true, claimed: claimed.jobs.length, sent, pending });
}
