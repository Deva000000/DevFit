# DevFit scale review — 2 October 2026

## Decision: 2,000 simultaneous-user production readiness is NOT signed off

The compatibility-safe database migrations were applied to production on
2 October. The application release is being rolled out through the normal Git
deployment. No production stress traffic, plan purchase or customer-data reset
was performed. There is no isolated hosted staging project available yet.

## Release verification

- 90 application regression tests passed, zero failures.
- 28 incremental SQL assertions passed locally and in a rollback-only production
  transaction. The probe left zero accounts/documents behind.
- Before and immediately after the migrations, all 86 canonical documents had
  the identical aggregate content/version fingerprint. Customer history unchanged.
- Desktop (1280×900) and mobile (390×844) Playwright checks passed: real workout
  inputs, field patch, reload persistence, conditional reads, offline edit and
  online recovery. Zero page exceptions or horizontal overflow; mobile numeric
  inputs compute to 16 px. Auth/provider responses were simulated for these UI
  checks; they are not real Google/iPhone authentication proof.
- The Browser plugin was unavailable; the frontend-testing skill's Playwright
  fallback was used. Screenshots and UI harness are temporary, outside the repo.
- Final isolated 100-account mixed burst: zero request errors, zero accepted-save
  mismatches, read p95 815 ms and write p95 627 ms. A separate 100-account
  incremental scenario had patch p95 470 ms and conditional-read p95 419 ms.
  Its example food edit sent 186 bytes instead of a 77,860-byte full document.
  These are local measurements, not production capacity promises.
- All newly added RPCs deny browser roles. Supabase security advisors reported
  no new database findings; the existing leaked-password warning concerns
  Supabase password Auth, which DevFit's Google sign-in does not use.

## Evidence and limits

The test uses 2,000 synthetic accounts, mixed Free/Pro, registered device-bound
sessions, realistic-sized history documents, real production API handlers and
real PostgreSQL 17 functions. It replaces managed PostgREST with a loopback HTTP
adapter. The load generator, API and adapter share one Node process on this
Windows workstation. PostgreSQL is a separate local process with 60 connection
slots and 128 MB shared buffers. This is not a Vercel/Supabase hardware replica.

Fixture documents contain 84 nutrition days (~78 KB), 52 workouts (~40 KB) and
12 progress weeks (~1.4 KB). Synthetic values are repetitive and compress well;
customers' history, receipts and long-duration use can be larger.

| Completed measurement | Result | Interpretation |
| --- | --- | --- |
| 100/250-user mixed bursts during iterative tests | No request errors or accepted-save mismatches; latency varied across runs | Functional evidence, not production capacity or an endurance pass |
| 2,000-user instantaneous burst | Numerous loopback `ECONNREFUSED` failures | Generator/local HTTP topology saturation; not evidence that production rejects the same number |
| 2,000-active-user schedule, pool 10, 45 seconds | 5,793 requests; 205 returned 503; p95 8,265 ms | Queue/deadline failure in this isolated topology |
| 2,000-active-user schedule, pool 20, 30 seconds | 3,996 requests; zero errors; p95 3,562 ms; p99 3,716 ms | Correctness improved, but misses the 2-second p95 target; too short for capacity sign-off |
| Abrupt local PostgreSQL stop and restart | All 6,001 committed synthetic documents retained identical aggregate content hash | WAL crash-recovery check passed; not a power-loss guarantee for a different cloud stack |
| Automated regression suites | 81 passed, zero failed | Includes client debounce/recovery, signed authorization, payment/support, Google key burst, and monitoring backpressure checks |
| Final SQL/API regression after the last quota adjustment | 100-user burst passed; 17 functional/security assertions plus fixtures passed; read p95 1,208 ms and write p95 909 ms | Confirms final implementation at this load; not a new 2,000-user capacity result |
| Harness dependency audit | Zero known vulnerabilities reported by `npm audit` | Point-in-time dependency result, not a penetration-test certificate |

The steady-state assumption is one edit every 30 seconds per active user:
approximately 67 saves/s plus 67 reads/s, not 2,000 requests/s. The 30-second run
issued 1,998 edit cycles on that arrival schedule and verified all accepted saved
documents. It tested a 100-account authorization burst before the steady phase,
not a successful 2,000-account instantaneous authorization burst.

The pool-20 result changes a **test adapter setting**, not production Supabase
configuration. It does not prove that doubling cloud connections fixes cloud
capacity. Queue depth reached 360 in that run; long sustained testing remains
essential. Early longer test invocations terminated without a final result;
they are not included as completed evidence or passes.

Suggested hosted SLO: p95 reads/saves below 2 s, p99 below 5 s, no unexplained
5xx/transport errors, no lost accepted saves, and at least 30% measured resource
headroom. The current harness fails its capacity gate when errors or latency
targets are missed; a "no data loss" result alone cannot make it pass.

## Changes implemented

1. **Reduce write amplification:** unchanged dated history rows are not rewritten
   or locked. Editing one food day changes one shadow row out of 84. Recovery
   snapshots remain bounded; avoid computing their hash when a recent snapshot
   already exists. Routine small edits now use bounded field patches; first
   writes, large changes and old clients retain whole-document uploads. Canonical
   physical storage still rewrites a complete document.
2. **Remove shared-network save contention:** account-derived IP counter shards
   replace one global hot row per NAT. Exact per-account quotas remain primary;
   sharded IP ceilings are approximate emergency protection, not a global exact
   IP quota. The final shard ceiling is 60,000/h, sized for roughly 2,000 NAT users
   at up to 1,200 saves/h/account plus hash skew. A regression explicitly checks
   legitimate saves above the earlier 6,000/h shard threshold. Authentication,
   device and blocklist checks remain mandatory.
3. **Combine security with the document transaction:** new private RPC overloads
   perform device/block checks and read/save in one database round trip.
   Legacy signatures remain available for the compatibility rollout.
4. **Protect concurrency:** first-write and stale-write races serialize and
   return conflicts rather than overwriting. Save timestamps advance after the
   lock. Simultaneous registrations cannot bypass the three-device policy.
5. **Bound housekeeping:** rate-bucket cleanup is amortized and bounded with
   `SKIP LOCKED`; security history cleanup is restricted to real logins. Known
   authenticated devices refresh their last-seen heartbeat at most every 15 min.
6. **Fix client recovery:** honor the full server `Retry-After`, prevent new edits
   bypassing cooldown, preserve newer pending edits, clear stale retry timers,
   and resume failed saves from durable on-device data. Existing 850 ms input
   debounce still collapses rapid typing.
7. **Bound dependency failure:** database write helpers have network deadlines;
   malformed RPC bodies return an unavailable result. Identical durable error
   events are sampled per warm instance for ten seconds while all events remain
   in application logs. Monitoring fallback has a short deadline so an outage
   does not add two long waits and two extra writes to every failed save.
8. **Reduce authentication bursts:** concurrent Google signing-key refreshes
   share one request per warm instance; unknown-key refresh storms are bounded.
   A 2,000-proof cryptographic test passes with a synthetic signing-key provider.
   This is not 2,000 real Google sign-ins.
9. **Improve repeatability:** full regression CI, opt-in isolated PostgreSQL scale
   workflow, realistic fixture harness, status/latency/queue measurements, and a
   cloud smoke test that requires an explicitly isolated nonproduction project,
   distinct synthetic accounts and their matching installation IDs.
10. **Reduce transport and redundant work:** exact-version field patches are
    validated and applied atomically. Structural replay is rejected; conflict
    merge handles lost acknowledgements. Unchanged documents skip uploads.
    Verified account-scoped on-device hashes allow metadata-only repeat reads;
    dirty or changed caches must obtain the full server copy. The client's
    acknowledged baseline is isolated from mutable UI input objects.
11. **Report failure honestly:** failed initial pulls do not start blind saves;
    manual sync reports failure instead of a false success. No-session queues
    do not spin an 850-ms retry loop. The public health route checks the deployed
    private sync protocol through the server service credentials.

## Real database inspection: read-only

Production is currently Supabase Free in Tokyo, PostgreSQL 17.6. At inspection:
12 active database connections out of a 60-slot ceiling, approximately 22.6 MB of
DevFit table storage, zero recorded database deadlocks, and RLS enabled on every
DevFit public table. This is low-traffic health evidence, not a load test.

The local 2,000-account fixture run occupied more than 600 MB including indexes
and accumulated test bloat. The dated row values alone occupied approximately
427 MB before table/index overhead. This is a scenario estimate, not a per-user
storage promise; still, the Free plan's 500 MB limit has insufficient room for
this tested history scenario. Do not infer capacity from monthly-active-user
allowances or equate active users with individual PostgreSQL connections.

Sources checked on 2 October 2026:

- [Supabase compute, disk and connection limits](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Supabase pricing and included database storage](https://supabase.com/pricing)
- [PostgreSQL 17.11/15.19 maintenance changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)

Schedule the supported database maintenance update with backup/recovery checks
and a downtime window. No in-place database version upgrade was attempted.

## Required next steps before a 2,000-user capacity claim

1. Approve/provision separate hosted staging with separate credentials and an
   explicit cost ceiling. Do not reuse customer production or an unrelated app.
2. Validate real PostgREST selection of the new RPC overloads in staging. Roll out
   migration first, then API, then clients; document compatible rollback.
3. Run from an independent Linux load generator: 100, 250, 500, 1,000 and 2,000
   users; 30-minute target workload and a 24-hour endurance/recovery run. Separate
   load-generator saturation from database CPU, lock waits, pooler queues,
   disk IO, egress and Vercel concurrency. Select compute based on these results.
4. Separately exercise login, large histories, PDF exports, private receipt
   uploads and support notifications. Heavy third-party-provider traffic must
   use mocks/approved sandboxes; low-rate real food-source smoke tests verify
   integration but cannot certify provider availability.
5. Migrate complete-history uploads/restores to versioned day/session mutation
   APIs and paginated reads for multi-year growth. Shadow rows alone do not
   remove the whole-document size ceiling. Preserve offline merges and explicit
   deletions in this separate staged compatibility migration.

Test instructions: [isolated scale harness](tests/scaling/README.md).
Local completed artifacts are under `tests/scaling/results/` (ignored by Git).
No customer data was used or altered.
