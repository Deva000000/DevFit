# DevFit operational gates

These procedures do not certify zero bugs or 2,000 simultaneous cloud writers.
Do not buy plans, upgrade/restart production, or load-test customer infrastructure
without the owner's explicit decision. Never paste secrets into tickets or chat.

## Notifications

The private `devfit-notification-retries` pg_cron job runs every five minutes.
Vault stores the high-entropy capability; only its hash is in `devfit_job_auth`.
The callback is the existing `/api/admin` route, but that capability cannot access
normal admin actions. Browser cookies/Origin are rejected on the job branch.
Source IDs and lease IDs are read from the service-only outbox, never the caller.

Normal uploads still try inline delivery. The worker retries two due failures per
tick, serially, with three-minute leases. A crashed worker is reclaimable. Six
worker attempts or a 23-hour age limit stops automatic delivery rather than
risking duplicate mail outside Resend's 24-hour idempotency window. Stored support
requests/receipts survive either outcome. This is not an inbox-delivery guarantee.
No access is activated by a notification. Historical tickets are not re-emailed.

Admin → Production Alerts shows waiting and needs-review counts. Inspect those
alongside each payment/support row's email status. If the queue grows, investigate
Resend configuration, provider quotas and callback failures; increasing retries
will not fix a missing/revoked key or a provider daily limit. An initial empty
callback validates the credential and deployed route without creating a ticket.

Read-only operator checks (never select the Vault secret or request headers):

```sql
select public.devfit_notification_status();
select jobname, schedule, active from cron.job
where jobname='devfit-notification-retries';
select status, return_message, start_time, end_time from cron.job_run_details
where jobid in (select jobid from cron.job where jobname='devfit-notification-retries')
order by start_time desc limit 10;
```

Emergency disable: an authorized database operator can set this job's `enabled`
flag false and unschedule its named cron job. Preserve the durable queue, source
records and Vault secret. Do not drop customer tables to stop notifications.

New hosted staging must disable this production-callback scheduler immediately
after migration, and must use separate email/JWT/database credentials. Disposable
local CI uses the explicit isolation marker and never installs managed extensions.

## Offsite backup — not yet operational

The owner confirmed no offsite storage account exists. A local export is not an
offsite backup, and Supabase database backups do not contain private Storage image
bytes. Do not call the Admin metadata export a complete disaster-recovery backup.

Required setup:

1. Owner selects a private external destination and approves any cost. Use a
   dedicated, least-privilege credential, not a public bucket or personal inbox.
2. Configure a scheduled database schema/data export and private receipt-object
   copy. Include a versioned manifest with timestamps, row/object counts and
   checksums. Store neither production passwords nor provider API keys in it.
3. Encrypt before uploading; retain the decryption key independently of the
   database, destination credential and backup file. Never commit it to Git.
4. Alert on failed/missed runs and unreasonable size/count changes. Agree a
   recovery-point/recovery-time objective and retention/deletion policy.
5. Restore into isolated staging, not production. Verify database ownership/RLS,
   subscriber activation, history, sample private image bytes/checksums and account
   deletion behavior. A successful download/decryption is not a restore drill.

## Database security patch

Production is PostgreSQL 17.6. Apply the provider's supported security upgrade
only after the independent backup/restore check and an agreed maintenance window.
The provider's upgrade includes downtime. Check extension compatibility and job
schedules afterwards; pg_cron may be recreated during an upgrade. Verify private
worker grants, Vault references, health, login, saves, Pro reports and receipt
readback. Never use an unannounced pause/restore as a shortcut for maintenance.

## Capacity — open release gate

Use a separate Supabase project and Vercel staging deployment, separate credentials
and synthetic accounts. Never point a preview or 2,000-write test at production.
Run realistic 100/250/500/1,000/2,000-user bursts, a 30-minute sustained test and a
24-hour lower-rate soak. Include large histories, reconnects, mixed Free/Pro,
concurrent devices, response loss, provider failure and deletion/recreation.

Keep the current targets: p95 under 2 seconds, p99 under 5 seconds, no lost
accepted writes, and at least 30% measured headroom. Collect API/DB latency, CPU,
memory, pool queue, WAL, locks, disk and egress. The local 2,000-account burst still
fails latency; no-op client fixes are not evidence that this gate passed.
Date-row storage/read pagination remains a separate staged migration, not a safe
one-line alteration to customers' canonical history.

## Real-device and provider gates

- On actual iPhones: fresh/existing Free/Pro accounts in Safari and Chrome,
  browser → Add to Home Screen → Google sign-in → force close → reopen. Cover
  cancelled OAuth, expired sessions, keyboard input and a slow/offline connection.
  Desktop mobile-width testing does not establish iOS reliability.
- Confirm a dedicated USDA key and commercially suitable hosting plan in the
  actual dashboards. Do not expose keys in screenshots or relax provider budgets.
- Rotate any previously exposed Resend key, enable dashboard MFA, and verify the
  real operator/support/contact/retention details. Code cannot invent these facts.
