// DevFit — POST /api/log
// Lightweight client crash/error sink. The app's window.onerror +
// unhandledrejection hooks (devfit-errorlog.js) post here so real-device failures
// are VISIBLE instead of silently swallowed by the app's many try/catch blocks.
//
// Storage: ALWAYS console.error (shows up in Vercel's function logs, zero setup),
// PLUS a best-effort insert into an OPTIONAL Supabase table `devfit_errors` for a
// durable history. If that table doesn't exist / backend isn't configured, the
// insert is skipped silently — logging never affects the user. Rate-limited per IP
// so a crash-looping client can't flood the sink.
//
// Optional table (run once in Supabase SQL editor for durable history):
//   create table devfit_errors (
//     id bigint generated always as identity primary key,
//     type text, message text, stack text, src text, page text, ua text,
//     at timestamptz default now()
//   );

import { readJsonBody, rateLimit, clientIp, sbInsert, haveServerConfig } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  const rl = await rateLimit('log:' + clientIp(req), 20, 300); // 20 errors / 5 min per IP
  if (!rl.ok) { res.status(200).json({ ok: false }); return; }

  const body = await readJsonBody(req);
  const rec = {
    type: String(body.type || 'error').slice(0, 20),
    message: String(body.message || '').slice(0, 500),
    stack: String(body.stack || '').slice(0, 1500),
    src: String(body.src || '').slice(0, 200),
    page: String(body.page || '').slice(0, 120),
    ua: String(body.ua || '').slice(0, 200),
    at: new Date().toISOString()
  };
  if (!rec.message && !rec.stack) { res.status(200).json({ ok: true }); return; }

  // Always land in Vercel's logs.
  console.error('[DevFit client error]', JSON.stringify(rec));
  // Durable, but optional.
  try { if (haveServerConfig()) await sbInsert('devfit_errors', rec); } catch (e) { /* best-effort */ }

  res.status(200).json({ ok: true });
}
