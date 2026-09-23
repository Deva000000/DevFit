# DevFit Layer 1 — Secure activation (signed tokens + Supabase + admin panel)

This replaces the "trust localStorage + hand-edit a Google Sheet" flow with a
**server-signed session token** and a **DevFit admin panel**. A faked
localStorage session no longer survives a page reload, and you activate clients
instantly from `admin.html` instead of the Sheet.

Everything is **dependency-free** (no `package.json`, no build step) and deploys
on your existing Vercel project.

---

## What was added

| File | Purpose |
|------|---------|
| `api/_lib.js` | Shared: JWT sign/verify, Supabase service REST, rate limiter |
| `api/session.js` | Login → verifies identity, returns a **signed** session token |
| `api/google-login.js` | Secure Google redirect callback required by iPhone/iPad |
| `api/verify.js` | Every page load → validates the token, returns live tier |
| `api/admin.js` | Password-gated owner backend (rate-limited) |
| `admin.html` | Owner panel — plans, receipts, support, alerts, devices and blocklist |
| `devfit-auth.js` | Shared client gate used by all app pages |

Wired into: `login.html`, `index.html`, `nutrition.html`, `workouts.html`,
`settings.html`. Current service worker release is **v4.92.0**.

---

## Current production security model

Strict server verification is enabled. Google proves the Gmail identity, DevFit
issues a signed session bound to the browser installation, and every protected
request re-checks the account on the server. Free/Pro status is never accepted
from localStorage or request-body email. Existing pre-device-binding sessions are
upgraded during normal verification without forcing customers to log in again.

---

## Step 1 — Supabase schema

The committed files in `supabase/migrations/` are the schema source of truth.
Do not copy isolated table snippets into production; apply the ordered migrations
so RLS, grants, atomic save/delete functions, payment/support privacy, security
events, device enforcement and the blocklist stay aligned.

The original baseline was:

Supabase dashboard → **SQL Editor** → run:

```sql
-- Subscriber list (the source of truth for who is Pro)
create table if not exists devfit_subscribers (
  email      text primary key,
  name       text,
  tier       text not null default 'free',   -- 'pro' | 'free'
  approved   boolean not null default true,   -- false = blocked from login
  expiry     date,                            -- null = no expiry (coached/lifetime)
  start_date date,
  plan       text,
  updated_at timestamptz default now()
);

-- Rate-limit counters (brute-force protection for the admin password)
create table if not exists devfit_rate (
  id       text primary key,
  hits     int not null default 0,
  reset_at bigint not null default 0
);

-- Login / device tracking (who signed in, from how many devices, when)
create table if not exists devfit_logins (
  email       text not null,
  device_id   text not null,
  user_agent  text,
  first_seen  timestamptz default now(),
  last_seen   timestamptz default now(),
  login_count int not null default 1,
  primary key (email, device_id)
);

-- Durable production error and health-event history.
create table if not exists devfit_errors (
  id      bigint generated always as identity primary key,
  type    text,
  message text,
  stack   text,
  src     text,
  page    text,
  ua      text,
  status  integer,
  at      timestamptz default now()
);

-- Lock all tables down: only the server (service-role key) may touch them.
alter table devfit_subscribers enable row level security;
alter table devfit_rate        enable row level security;
alter table devfit_logins      enable row level security;
alter table devfit_errors      enable row level security;
-- No policies = the public anon key cannot read or write. Service key bypasses RLS.

-- Bounded recovery history for account data. The app reads the current
-- devfit_data row; distinct previous states are kept here for recovery.
create table if not exists devfit_data_versions (
  id            bigint generated always as identity primary key,
  email         text not null,
  data_type     text not null,
  data          jsonb not null,
  content_hash  text not null,
  source_device text,
  created_at    timestamptz not null default now(),
  unique (email, data_type, content_hash)
);
alter table devfit_data_versions enable row level security;
create index if not exists devfit_data_versions_lookup_idx
  on devfit_data_versions (email, data_type, created_at desc);
```

> **Note:** the `prefs` cloud backup (display name, goals, view prefs — added for
> iOS storage-eviction durability) reuses the existing `devfit_data` table's
> `data_type` column, so there is **no new table** to create for it.

## Step 2 — Vercel: set environment variables

Project → **Settings → Environment Variables** (Production + Preview):

| Name | Value |
|------|-------|
| `DEVFIT_JWT_SECRET` | A long random string. Generate: `openssl rand -hex 32` |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → **service_role** key (secret!) |
| `DEVFIT_ADMIN_PASSWORD` | A strong password you'll type into `admin.html` |
| `SUPABASE_URL` | *(optional)* defaults to your project URL already |
| `GOOGLE_CLIENT_ID` | *(optional)* defaults to the public Google web client ID already used by DevFit |

> The **service_role** key must never appear in client code — it only lives in
> Vercel env and is used by `api/*` server-side. That's the whole point.

**Redeploy** after setting them (env changes need a fresh deploy).

## Step 2A — Google-only login and canonical URL

Google ID-token sign-in is the only login shown to users. The server verifies the
token signature, audience, issuer, lifetime, verified email, and stable Google
subject before creating the DevFit session.

In Authentication → URL Configuration:

- Set Site URL to `https://devfitportal.vercel.app`.
- Remove the old Netlify URL from Redirect URLs.
- Keep only `https://devfitportal.vercel.app/**`.

The login page contains no email-link flow or browser Supabase client. Existing
signed DevFit sessions remain valid until manual logout or account revocation.

In Google Cloud Console, keep `https://devfitportal.vercel.app` in the OAuth web
client's Authorized JavaScript origins and keep this exact Authorized redirect
URI:

- `https://devfitportal.vercel.app/api/google-login`

iPhone and iPad use Google's required redirect mode; Android and desktop keep
the popup flow. The redirect handler checks Google's double-submit CSRF token
before the server validates the ID token and creates a DevFit session.

## Step 3 — Migrate your current clients

Two options:

- **Easiest (a few clients):** open `https://devfitportal.vercel.app/admin.html`,
  unlock, and `Activate Pro` each client email with the right number of days.
- **Bulk:** in Supabase SQL Editor:
  ```sql
  insert into devfit_subscribers (email, name, tier, approved, expiry, plan)
  values
    ('client1@gmail.com','Client One','pro', true, '2026-08-01','Pro'),
    ('client2@gmail.com','Client Two','pro', true, '2026-08-15','Pro')
  on conflict (email) do update
    set tier=excluded.tier, approved=excluded.approved, expiry=excluded.expiry;
  ```

## Step 4 — Test before enforcing

1. Open `admin.html` → unlock with `DEVFIT_ADMIN_PASSWORD` → you should see the list.
2. Activate a test Gmail, log in with it on the app → should reach the dashboard as Pro.
3. In DevTools, check `localStorage` has a `devfit_token` (three dot-separated parts).
4. Try the old hack: set `devfit_user.tier='pro'` for a Free account, reload →
   with the backend live, `/api/verify` corrects it back to Free.

## Step 5 — Verify enforcement

`devfit-auth.js` is already in strict mode. Test a Free account, a Pro account,
a revoked account, a replaced phone after an owner device reset, and a fourth
new device. The first three active devices are allowed; a fourth is denied and
appears in Admin → Security & Blocklist.

## Incident response

Do not remove `DEVFIT_JWT_SECRET` as a routine rollback; that disables signed
session verification. Revert the application commit, preserve the database, and
use Admin → Security & Blocklist to revoke a confirmed abusive account or reset
trusted devices for a legitimate customer.

## Honest scope

Server enforcement stops forged sessions, cross-account data access, API use by
revoked accounts, and changes to the authoritative Pro subscription. A browser
owner can always alter pixels or JavaScript on their own screen, so DevFit does
not use unreliable DevTools detection or auto-ban people for opening developer
tools. Any premium computation that must be impossible to reproduce locally must
eventually run on the server; frontend code can be inspected by design.
