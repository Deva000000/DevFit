// Cookie bootstrap only. Every data/Pro request still needs an explicit,
// device-bound bearer token and a live database authorization check.
import { signToken, verifyToken, sha256Hex, cookieValue } from './_lib.js';

const COOKIE = '__Host-devfit_session';
const ACTIVE = '__Host-devfit_active';
export function browserContext(payload) {
  return sha256Hex('browser-context|' + payload.email + '|' + payload.sid + '|' + payload.did);
}
export function setBrowserSession(res, payload, deviceId) {
  const context = browserContext(payload);
  const value = signToken({ kind: 'devfit_browser', session: {
    email: payload.email, sid: payload.sid, did: payload.did, deviceId, context
  } });
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`);
  return context;
}
export function readBrowserSession(req) {
  const value = verifyToken(cookieValue(req, COOKIE));
  const session = value?.kind === 'devfit_browser' && value.session;
  // The active marker is set by the client only after accepting a response.
  // A late response from account A cannot silently restore A over account B.
  if (!session || session.context !== browserContext(session)
      || cookieValue(req, ACTIVE) !== session.context
      || sha256Hex(session.deviceId) !== session.did) return null;
  return session;
}
export function clearBrowserSession(req, res, payload) {
  const current = readBrowserSession(req);
  if (!current || (current.email === payload.email && current.sid === payload.sid)) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  }
}
