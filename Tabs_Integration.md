# DevFit — Nutrition + Training Tabs Integration

You now have a 3-tab fitness app:

| Tab | File | Purpose |
|---|---|---|
| **Progress** | `login app.html` (existing) | Daily habits + weekly score |
| **Nutrition** | `nutrition.html` (new) | Calories & macros, 7-day trend |
| **Training** | `workouts.html` (new) | Plan, log sessions, track progression |

Each is a separate page, but with the service worker cache they switch instantly — feels like real tabs in a native app.

---

## What's in each new tab

### Nutrition
- Daily targets (cals, protein, carbs, fat)
- Per-day food log with inline edit
- Auto-calculated daily totals with on-target / over / under indicators
- 7-day trend chart with target line, color-coded bars, variation analysis
- Date navigation (prev/next/picker) — log any day, not just today
- All saved to localStorage instantly

### Training
- **Plan mode** — build workout templates (e.g. "Day A — Upper", "Day B — Lower") with exercises and target sets/reps. Edit anytime.
- **Log Session mode** — pick date + workout → log actual sets (reps × weight) per exercise. Shows the last session's numbers next to each set so the client knows what to beat. Auto-shows a green "▲ Progressed +2.5kg" pill the moment they exceed it.
- **Progress mode** — pick any exercise → see PR, total sessions, weight change, line chart of best-set weight over time.

---

## Deployment — 3 steps (~5 min)

### Step 1 — Upload the new files to your repo
Push these 3 files to the same folder as `login app.html` in your GitHub repo:
- `nutrition.html`
- `workouts.html`
- `manifest.json` (replaces the old one — now has shortcuts to all 3 tabs)

### Step 2 — Add the tab nav to `login app.html`

Open `login app.html`, find this block (around line 218, right after the closing `</div>` of `.header`):

```html
  </div>

  <!-- COUNTDOWN RING -->
```

Insert this block immediately before `<!-- COUNTDOWN RING -->`:

```html
  <!-- TAB NAV (shared across Progress / Nutrition / Training) -->
  <nav class="devfit-tabnav">
    <a href="login app.html" class="active">Progress</a>
    <a href="nutrition.html">Nutrition</a>
    <a href="workouts.html">Training</a>
  </nav>
```

Then add this CSS — paste it right before `</style>` (around line 196):

```css
.devfit-tabnav{background:#111;border-radius:14px;padding:6px;margin-bottom:14px;display:flex;gap:4px;border:1px solid #2a2a2a}
.devfit-tabnav a{flex:1;text-align:center;padding:10px 8px;border-radius:8px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,0.6);text-decoration:none;transition:all .15s}
.devfit-tabnav a:hover{color:rgba(255,255,255,0.9)}
.devfit-tabnav a.active{background:#cc0000;color:#fff;box-shadow:0 2px 8px rgba(204,0,0,0.35)}
```

That's it — the tab nav matches the same one already built into `nutrition.html` and `workouts.html`.

### Step 3 — Push and test
1. Push everything to GitHub.
2. Wait ~1 min for Pages to deploy.
3. Open the app on your phone — you'll see the 3 tabs across the top.
4. Tap each — instant switch, no page-load flicker.

---

## Important notes

**Data is local-only for v1.** Nutrition and training data stays in the browser's localStorage on each client's device. This means:
- Works offline immediately
- No Apps Script changes needed
- Each client owns their own data on their phone
- **But:** if a client clears browser data, it's gone. And the trainer can't see it from the Sheet yet.

**Sync to Google Sheets is the v2 upgrade.** When you're ready, add 2 new tabs to your Google Sheet (`Nutrition`, `Workouts`) and ~30 lines to your Apps Script. I can build that when you ask.

**Auth gating.** The new pages don't currently re-check the OAuth approval status. For commercial launch, copy your existing access-check function from `login app.html` into the head of each new page (or extract to a shared `auth.js`). Same logic, same Apps Script endpoint.

---

## What this unlocks for the business

You now genuinely have a **fitness app**, not a habit tracker. When pitching to other Malaysian trainers, the value prop becomes:

> "Your clients get one branded app on their phone. Daily habits, calorie logging, workout tracking — all in one place. Auto-syncs to your Google Sheet, no app store, no monthly platform fees."

Three competitive moats this gives you over MyFitnessPal / Hevy / Strong:
1. **Trainer-first** — the trainer sets the workout plan, sees client progress, owns the data. MyFitnessPal/Hevy are client-first apps.
2. **Bundled** — clients don't juggle 3 apps. One icon, one login.
3. **White-labellable** — you (and other trainers) own the brand. No "powered by X" footer.

---

## What to build next (priority order)

1. **Streak counter on Progress tab** — "🔥 12-day logging streak". 10 lines of JS, massive habit-formation impact.
2. **Quick-add favorites in Nutrition** — "your top 10 most-logged foods, one tap to add". Removes the #1 friction in calorie tracking.
3. **Rest timer in Training** — start a countdown after each set is saved. Tiny feature, perceived as premium.
4. **Sheet sync for nutrition + training** — so trainer sees everything from one Sheet.
5. **Push notifications** — "Don't break your streak — log today" at 9 PM.
6. **Apply scoring fix** from the original Audit doc — the diet/stress bug is still live in `login app.html` until you patch it.

Tell me which to build next.
