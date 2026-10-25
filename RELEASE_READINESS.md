# DevFit v4.96.1 — release evidence and remaining gates

Reviewed 26 October 2026. This is not a guarantee of zero defects or a certificate
for 1,000/2,000 concurrent production users.

## Implemented

- Finite 30-day bearer tokens, separately revocable 90-day server sessions.
  Logout revokes the current session. Device reset and account revocation revoke
  existing sessions; reactivation cannot resurrect old tokens.
- A seven-day, existing-device-only migration for signed legacy sessions.
  Expired tokens are not accepted. A temporary store outage preserves the cached
  session instead of masquerading as account revocation. Logs remain namespaced
  and are not deleted when a user must sign in again.
- Current account/device/block checks and durable account-first limits on data,
  verification, Pro and food routes. Higher emergency shared-IP ceilings for
  Google sign-in, receipts and support avoid low-volume shared-Wi-Fi lockouts.
- Insert-only first signup: concurrent owner activation/revocation cannot be
  overwritten by a default Free/approved upsert.
- Workout, nutrition and progress PDFs generated server-side from the authenticated
  account's saved data, after checking current Pro activation and dates. No client
  report HTML, chart image, file path, email or claimed tier is trusted.
  Paid report analysis/renderer are no longer served in the new browser bundle.
  Export waits for successful account sync, rather than silently exporting stale
  cloud data. Reports are bounded to 104 weeks per export.
- PDF-native vector charts; existing weekly detail, exercise remarks and diet
  target checks retained. jsPDF pinned to 4.2.1; production dependency audit clean.
  PDF libraries are no longer fetched from a CDN by customer pages.
- Bounded workout targets (sets 1–30, reps 1–1,000, minutes 0–1,440, km 0–1,000),
  frontend and API validation, and safe set allocation. Duration metadata cannot
  allocate millions of weeks. Existing recorded rows are not truncated.
- Content-verified PWA shell: a missing/mismatched required file aborts installation.
  Cache identities are derived from content as well as the human version label.
  Shell navigation uses one cached release, not independently refreshed HTML/JS.
  Manual updates preserve local queues and require other DevFit tabs to close.
- Public health requests use CDN caching and a coalesced database probe.

Previously downloaded renderer code or personal cached data cannot be remotely
made uncopyable. Browser developer tools are not a security boundary. The new
server service, account data, activation and admin routes are the enforceable
boundaries. Do not promise console-proof UI or ban people merely for debugging.

## Verification

- 137 automated tests; all pass. CI uses Node 24 and checks release hashes.
- Fresh disposable PostgreSQL: all migrations apply. Rollback-only incremental,
  program, food-cache and new session/revocation tests pass.
- Actual local handlers plus PostgreSQL, desktop 1280px and mobile-width 390px:
  public pages, all four app pages, save/readback, offline reload/retry, nutrition
  search/portion save, workout save, all three PDFs, archived-program PDF, receipt
  and support submissions, Free denial, admin error grouping; no uncaught errors.
  Food responses/private image storage were simulated. No real emails were sent.
- PDFs rendered and visually inspected; text wrapping and a malformed minus sign
  corrected. No customer records were used as test fixtures.
- 2,000-account local run: mixed bursts at 100/250/500/1,000/2,000 had no failed
  requests or incorrect accepted-write readbacks. 2,000 current Free/Pro decisions
  were correct. 100 incremental patch/conditional-read checks were correct.
- 120-second staggered workload: 2,000 logical users, one edit per user per 30s,
  16,002 requests, all successful; p95 59ms, p99 720ms, no missed arrival slots.
- Capacity gate **FAILS**: the 2,000-user synchronized whole-document burst had
  p95 approximately 10.9s read / 12.3s write / 11.6s readback, exceeding 2s p95
  and 5s p99 targets. The single local Node API/generator and local PostgreSQL pool
  do not reproduce Vercel's distributed runtime or Supabase's managed capacity.
  Do not reinterpret correctness as a production capacity pass.

Raw synthetic-only results remain under ignored `tests/scaling/results/`.

## Still required — not claimed fixed

1. Confirm a dedicated USDA API key and a commercially suitable hosting plan.
   Upstream OFF/USDA quotas and availability cannot be removed by frontend code.
   Do not disable provider budgets to create the appearance of availability.
2. Configure a durable scheduled notification retry worker/outbox. Receipt/support
   records are saved before email and manual owner retry exists, but automatic
   delivery retry after process crashes is not yet guaranteed.
3. Configure encrypted offsite database **and private Storage-object** backups;
   run an isolated restore drill. The owner export is manual and metadata alone
   is not a backup of receipt image bytes. Customer import/export stays removed.
4. Book a backed-up maintenance window for the provider's PostgreSQL security
   patch. No disruptive production upgrade was performed during this release.
5. Real iPhone Safari/Chrome → Add to Home Screen → Google sign-in/reopen testing
   with fresh and existing accounts. Windows Chrome mobile width is not iOS proof.
6. Isolated hosted staging and measured cloud load tests before advertising a
   1,000/2,000-concurrent-user capacity guarantee. Spending/provisioning needs owner
   approval. Larger history still needs dated-row storage instead of repeatedly
   materializing the account's whole document.
7. Confirm legal operator/support/retention details and rotate any email API key
   previously exposed in screenshots. Dashboard MFA and ongoing patch/alert
   ownership remain operational responsibilities, not one-time code fixes.

The current small customer cohort and gradual rollout are materially different
from an unrestricted large launch. Continue checking failed saves, p95 latency,
provider limits, database/storage usage, pending receipts and delivery failures.

## Rollout

Apply the additive session migration before deploying API/client code. It does
not rewrite progress, nutrition, workouts, subscriptions or receipt data. Existing
users should use the Update ready banner; no uninstall or data reset is needed.
Inactive legacy sessions may need one fresh Google sign-in. Keep the migration
when rolling code back: it is backward-compatible with the previous API, and
dropping session tables is not a safe rollback procedure.
