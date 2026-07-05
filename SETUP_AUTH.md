# DevFit Layer 1 — Secure activation (signed tokens + Supabase + admin panel)

This replaces the "trust localStorage + hand-edit a Google Sheet" flow with a
**server-signed session token** and a **trainer admin panel**. A faked
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
| `api/verify.js` | Every page load → validates the token, returns live tier |
| `api/admin.js` | Password-gated activation backend (rate-limited) |
| `admin.html` | Your trainer panel — activate/extend/revoke clients |
| `devfit-auth.js` | Shared client gate used by all app pages |

Wired into: `login.html`, `index.html`, `nutrition.html`, `workouts.html`,
`settings.html`. Service worker bumped to **v4.45.0**.

---

## Rollout is safe by design

The client runs in **transition mode** first. If the backend isn't configured,
every endpoint returns `501` and the app **falls back to the current Sheet
behaviour** — so you can deploy this commit right now and **no one is locked
out**. You only get the security benefit after the steps below, and you flip on
"strict" enforcement as the final step.

---

## Step 1 — Supabase: create the tables

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

-- Lock all tables down: only the server (service-role key) may touch them.
alter table devfit_subscribers enable row level security;
alter table devfit_rate        enable row level security;
alter table devfit_logins      enable row level security;
-- No policies = the public anon key cannot read or write. Service key bypasses RLS.
```

## Step 2 — Vercel: set environment variables

Project → **Settings → Environment Variables** (Production + Preview):

| Name | Value |
|------|-------|
| `DEVFIT_JWT_SECRET` | A long random string. Generate: `openssl rand -hex 32` |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → **service_role** key (secret!) |
| `DEVFIT_ADMIN_PASSWORD` | A strong password you'll type into `admin.html` |
| `SUPABASE_URL` | *(optional)* defaults to your project URL already |
| `SUPABASE_ANON_KEY` | *(optional)* defaults to the publishable key already in the app |

> The **service_role** key must never appear in client code — it only lives in
> Vercel env and is used by `api/*` server-side. That's the whole point.

**Redeploy** after setting them (env changes need a fresh deploy).

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

## Step 5 — Turn on strict enforcement

In `devfit-auth.js`, change:

```js
var STRICT = false;   →   var STRICT = true;
```

Bump the service worker version (`sw.js`: `VERSION` + top comment) and redeploy.
Now an invalid/absent token **while online** forces re-login. (Offline still
trusts the cached session — that's required for the PWA to work offline, and is
the documented Layer-1 limit.)

> **One-time re-login:** existing users logged in *before* this system only
> have a session, not a signed token. The moment you flip strict, each of them
> is asked to log in once (a single magic-link tap) which mints their token.
> Expected and harmless — just don't flip it in the middle of a busy day.

## Step 6 (later) — retire the Google Sheet

Once every client is in `devfit_subscribers` and strict mode is stable, you can
delete the `SHEET_URL` fallback blocks. They're harmless until then (they only
run if `devfit-auth.js` fails to load).

---

## Rollback

If anything misbehaves: unset `DEVFIT_JWT_SECRET` in Vercel and redeploy. Every
endpoint returns `501`, the client falls back to the Sheet path, and you're
exactly where you started. No data is lost — `devfit_subscribers` just sits idle.

## Honest scope

Layer 1 stops **persistent** forgery (faked localStorage that survives reload)
and hides the backend secret. It does **not** stop someone overriding `isPro()`
live in their own console for a single session — that resets on reload and would
require the Layer-3 server-rendered rewrite you chose to skip.
