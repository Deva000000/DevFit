# DevFit isolated scale validation

This is a capacity and correctness test, not a certificate that production can
serve 2,000 simultaneous users. It executes the real API handlers and real
PostgreSQL functions. A small local HTTP adapter replaces managed Supabase
PostgREST. The API, adapter and generator share one Node process; this deliberately
does **not** reproduce Vercel's distributed execution, CDN or Supabase's pooler.

## Safety and prerequisites

- PostgreSQL 17 and Node 22+, on a disposable local instance.
- No customer data, production tokens, service keys, Google credentials, email
  delivery or third-party food API calls.
- A new database named `devfit_scale` (or `devfit_scale_<suffix>`), accessible only
  on loopback. `bootstrap.sql` adds an isolation marker and local-only roles.
- The harness refuses cloud database hosts and databases without that marker.
- Fixture reset truncates only app fixture tables in that isolated database.

Create the empty local database, apply `bootstrap.sql`, then apply every file in
`supabase/migrations` in filename order using `psql -v ON_ERROR_STOP=1`.
Install dependencies with `npm ci --prefix tests/scaling`.

PowerShell example:

```powershell
$env:DEVFIT_SCALE_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/devfit_scale'
$env:DEVFIT_SCALE_USERS='2000'
$env:DEVFIT_SCALE_LEVELS='100,250,500,1000,2000'
$env:DEVFIT_SCALE_SOAK_SECONDS='300'
node tests/scaling/scale.mjs
```

GitHub's **DevFit isolated scale validation** workflow runs the same test on a
disposable Linux PostgreSQL service. It has no production credentials. It is
manual, not an automatic 2,000-user test on every push.

## Workload and assertions

2,000 distinct synthetic accounts, half Free and half Pro, with registered
device-bound signed sessions. Each account has 84 nutrition days, 52 workouts
with six exercises and three sets, and 12 progress weeks. Approximate JSON sizes:
78 KB nutrition, 40 KB workouts and 1.4 KB progress.

Burst levels perform read → edit → save → exact read-back, on one simulated shared
public IP. The sustained phase staggers 2,000 users making an edit every 30 seconds:
about 67 saves/s plus 67 reads/s. It uses an open arrival schedule and records
missed schedule slots, pending work when arrivals stop, and drain time. This activity assumption is explicit, not "2,000 requests
per second".

Other checks cover first-write races, stale-version conflicts, lost responses
after committed saves, outages and recovery, revocation, forged tokens, Free/Pro
authorization, private RPC privileges, RLS, oversized payloads, duplicate IDs,
invalid calendar dates, and simultaneous device registration.
The final protocol also tests 100 concurrent incremental food edits with exact
read-back and metadata-only conditional reads. `incremental-regression.sql`
provides 28 small rollback-only SQL assertions for nested patches, structural
replay, zero/false/null, invalid paths, device binding and revocation.

Reports include status counts, p50/p95/p99 latency, pool queue depth, API transport
failure codes, memory, event-loop delay and database sizes. A non-200 write is a
failed attempt, **not evidence that an accepted save was lost**. Read-back integrity
is asserted only for accepted saves. Expected security rejections are not failures.
The capacity gate also requires p95 below 2 s and p99 below 5 s; a correctness-only
pass is not sufficient. `cloudCapacityVerified` is always false in this harness.

`results/*.json` is ignored by Git. Preserve a selected result in release evidence
after inspecting it for synthetic-only contents.

Optional controls: `DEVFIT_SCALE_LABEL`, `DEVFIT_SCALE_SKIP_SEED=1` (existing exact
fixture set), `DEVFIT_SCALE_GATE_USERS` (default 2,000, lower only when isolating
steady-state from authorization bursts). Reducing either burst or gate users must
be disclosed; it is not a full 2,000-user burst pass.

## Hosted staging validation still required

Provision a separate Supabase project and Vercel staging deployment with separate
JWT/service credentials. Never point a preview load test at the production
database. Set `DEVFIT_ENVIRONMENT=staging` and `DEVFIT_LOAD_PROJECT_REF` to that
nonproduction Supabase reference. The staging health response must confirm both.

`tests/load-data-api.mjs` is a **small preference-document cloud smoke test**; it
requires 2,000 distinct synthetic tokens and matching device IDs and refuses the
canonical production host. It does not replace realistic history payloads, an
independent load generator, or hosted soak tests.

Release capacity gates on hosted staging:

1. Realistic history payloads, 100 → 250 → 500 → 1,000 → 2,000 concurrent users.
2. Suggested SLO: reads and saves p95 below 2 s, p99 below 5 s, no lost accepted
   saves, no unexplained 5xx/transport failures, and legitimate activity not
   blocked by shared-IP limits. Tune targets explicitly, not to hide failures.
3. 30-minute 2,000-active-user sustained test; then a 24-hour lower-rate endurance
   test. Include mixed account sizes and split-network users.
4. Kill/restart dependencies, simulated lost responses and device reconnects.
5. Measure database CPU/memory, WAL, locks, connections, disk IOPS, egress and
   Vercel invocation/concurrency usage. Require at least 30% measured headroom.
6. Separately test receipt/storage limits, PDF exports and account login. Mock
   external providers for heavy stress; use low-rate real provider smoke checks.

## Rollout order

The new context-aware RPC overloads must be installed **before** deploying the
updated API. Existing exact signatures stay available for legacy clients. Verify
real PostgREST overload selection in staging, then deploy database → API → clients.
No destructive reset or customer history migration is part of this change.
If rolling back, first restore the earlier API/client; leave additive overloads
installed until old traffic is drained. Do not stress production to validate it.

For multi-year growth, the current complete-document upload remains a limitation:
dated shadow rows reduce write amplification but do not make uploads or restores
incremental. Move to versioned per-day/session mutation APIs and paginated history
in a separate compatibility migration, with offline tombstone/merge tests. Raising
the payload limit would only postpone the underlying issue.
