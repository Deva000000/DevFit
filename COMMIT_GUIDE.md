# DevFit v2.0 — Deploy Checklist

## What changed

| Area | Fix |
|---|---|
| Login flow | `login.html` now lives alongside the app and redirects to `index.html` (not the old hardcoded URL). Auth re-check on every tab uses relative paths. |
| Tab nav | All four pages (Progress, Nutrition, Training, Settings) share a 4-tab nav. |
| Progress page bottom | Reduced to **Export This Week (PDF)** + **Clear this week** only. All other actions moved to Settings tab. |
| Settings page (new) | `settings.html` — Profile card (name, email, plan, expiry, status), Week Report PDF, Program Report PDF (with range), Sync to Trainer, Reset All Data, Logout. |
| Auth gating | `nutrition.html` and `workouts.html` now redirect to `login.html` if no valid session. |
| Workout share bug | Fixed `totalReps` variable shadowing the function — share card now generates correctly. Share button also enables for bodyweight exercises (no kg required). |
| Mobile overflow | All pages: added `overflow-x:hidden`, `min-width:0` on flex/grid items, tighter mobile gaps, dual breakpoints (540px and 380px). |
| PWA | `sw.js` cache list updated to `index.html`, `login.html`, `nutrition.html`, `workouts.html`, `settings.html`. Version bumped to v2.0.0 (forces clients to refresh). `manifest.json` start_url, shortcuts, and icon purposes corrected. |

## Step 1 — Rename the entry file

In Windows Explorer, inside `C:\Users\DevaaPrasad\OneDrive - DAIKIN HOLDINGS SINGAPORE PTE LTD\Desktop\.P\diet`:

- Right-click **`login app.html`** → Rename → **`index.html`**

(All code already references `index.html`.)

## Step 2 — Verify icons

Confirm `icon-192.png` and `icon-512.png` exist in the folder. If missing, copy them from `..\code app\`. The GitHub Pages deployment already has them, but they need to be in the local folder for git to track them.

## Step 3 — Commit & push

Open Git Bash in the diet folder (right-click in Explorer → "Git Bash Here") and run:

```bash
# Stage everything (rename of login app.html → index.html will be detected automatically)
git add -A

# Optional cleanup of repo clutter
git rm -f DevFit_Audit_v1.md PWA_Setup_Guide.md Tabs_Integration.md DEPLOY_STEP_BY_STEP.md COMMIT_GUIDE.md 2>/dev/null
git rm -f favicon-96x96.png apple-touch-icon.png web-app-manifest-192x192.png 2>/dev/null
git rm -f "icon-maskable-512.png.png" site.webmanifest favicon.svg 2>/dev/null

git commit -m "v2.0: unify login flow, add Settings tab, fix mobile overflow + workout share"
git push origin main
```

If the repo uses `master` instead of `main`, swap the branch name. If you don't have Git Bash, use GitHub Desktop: drag the diet folder in, review the changes, hit "Commit to main" → "Push origin".

## Step 4 — Verify after GitHub Pages redeploys (~60s)

1. Open `https://deva000000.github.io/DevFit/` on phone — should redirect to `login.html`.
2. Sign in with Google → should land on the new Progress page (the v2 version, not the old one).
3. Tap each tab — Progress, Nutrition, Training, Settings — all should load instantly.
4. On Settings, hit "Sync to Trainer" once to confirm the Apps Script POST still works.
5. On Training, log a set with both reps and weight, then tap **Share Workout Card** — modal should open with the rendered card image.

If the old version still appears, hard-refresh once (Ctrl+Shift+R) — the new service worker has version `v2.0.0` and will replace the v1 cache automatically on next load.

## Step 5 — Optional: delete the legacy `code app` folder

The old `code app` folder is no longer the source of truth. If it's not under git tracking, delete it from your Desktop. If it is, run `git rm -r "code app"` from the parent folder.
