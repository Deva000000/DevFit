// DevFit — Google Identity Services redirect handler for iPhone/iPad.
//
// Google requires redirect UX on iOS because of Intelligent Tracking
// Prevention. GIS POSTs the ID credential here. We first validate Google's
// double-submit CSRF token, then finish the existing /api/session exchange in
// the same PWA window so the signed DevFit session is saved to that installed
// app's own storage.

import crypto from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ||
  '94871311791-ql8k9lo0q9e1uq3ri98ghnfr1m187chh.apps.googleusercontent.com';

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function readForm(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else if (req && req[Symbol.asyncIterator]) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > 32768) throw new Error('body_too_large');
      chunks.push(part);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

function readCookie(req, name) {
  const header = String((req.headers && req.headers.cookie) || '');
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }
  return '';
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeJson(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function errorPage(message) {
  const text = String(message || 'Google sign-in could not be completed.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#cc0000"><title>DevFit — Sign-in</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090a;color:#eee;font-family:system-ui,sans-serif}.card{width:min(390px,100%);padding:30px;border:1px solid #2b2b2d;border-top:3px solid #c00;border-radius:16px;background:#121214;text-align:center}.brand{font-size:25px;font-weight:800;font-style:italic}.brand b{color:#c00}.msg{margin:18px 0;color:#aaa;line-height:1.5}a{display:block;padding:13px;border-radius:10px;background:#c00;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><main class="card"><div class="brand">DEV<b>FIT</b></div><p class="msg">${text}</p><a href="/login.html?auth=failed">Return to sign-in</a></main></body></html>`;
}

function successPage(credential) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#cc0000"><title>DevFit — Signing in</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090a;color:#eee;font-family:system-ui,sans-serif}.card{width:min(390px,100%);padding:34px;border:1px solid #2b2b2d;border-top:3px solid #c00;border-radius:16px;background:#121214;text-align:center}.brand{font-size:27px;font-weight:800;font-style:italic}.brand b{color:#c00}.msg{margin:18px 0 0;color:#aaa}.spin{width:28px;height:28px;margin:22px auto 0;border:3px solid #333;border-top-color:#c00;border-radius:50%;animation:s .7s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style>
<script src="/devfit-auth.js"></script></head><body><main class="card"><div class="brand">DEV<b>FIT</b></div><p class="msg">Completing secure sign-in…</p><div class="spin" aria-label="Signing in"></div></main>
<script>(async function(){try{var result=await DevFitAuth.startSession('google_id',${safeJson(credential)},'');if(result&&result.approved){document.cookie='devfit_email='+encodeURIComponent(result.email)+';max-age=31536000;path=/;SameSite=Lax;Secure';location.replace('/index.html');return}location.replace('/login.html?auth='+(result&&result.status==='pending'?'pending':'denied'));}catch(e){location.replace('/login.html?auth=failed');}})();</script></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send(errorPage('Please start sign-in from the DevFit app.'));
    return;
  }

  let body;
  try { body = await readForm(req); }
  catch (_) { res.status(400).send(errorPage('The sign-in response was invalid. Please try again.')); return; }

  const credential = String(first(body.credential) || '');
  const bodyCsrf = String(first(body.g_csrf_token) || '');
  const cookieCsrf = readCookie(req, 'g_csrf_token');
  const clientId = String(first(body.client_id) || '');

  if (!sameSecret(cookieCsrf, bodyCsrf)) {
    res.status(400).send(errorPage('The secure sign-in check failed. Please try again.'));
    return;
  }
  if (!credential || (clientId && clientId !== GOOGLE_CLIENT_ID)) {
    res.status(400).send(errorPage('Google did not return a valid DevFit sign-in. Please try again.'));
    return;
  }

  res.status(200).send(successPage(credential));
}
