# DevFit Audit & Optimization — v1

**Goal:** prepare the platform for scaled commercial launch (selling to other Malaysian trainers).
Audit covers: scoring fairness, misleading UI, hosting, and mobile PWA icon.

---

## 1. CRITICAL BUG — Diet & Stress are collected but NEVER scored

In `calcTrueScore(w)` (around line 748) the scores object only contains:
`bw, ol, steps, sleep, bf` — **diet and stress are missing from the calculation entirely.**

Yet the UI tells clients otherwise:
- Top legend (line 375): says weights are 30/25/20/15/10 with no diet/stress.
- Bottom tile legend (lines 403–423): shows "Steps 20% · Sleep 20% · Overload 20% · Diet 20% · Stress 10% · Body fat 10%" — and this doesn't even include bodyweight.
- Memory note from earlier conversations claims yet a third weighting (bw 25, ol 20, diet 20, steps 15, sleep 15, stress 10, bf 10).

Three different weight stories and the actual code matches none of them. This is the single biggest credibility issue when you start selling to other trainers — anyone who reverse-engineers the score will catch it.

---

## 2. Recommended new scoring system (balanced, defensible, scalable)

### Design principles
1. **Effort > outcome.** Outcome (weight, body-fat) ≈ 35%. Effort (training, diet, recovery, activity) ≈ 65%. Stalls in scale weight don't punish a client doing everything right.
2. **Adaptive normalisation.** If body-fat isn't tracked, the remaining weights re-normalise (your code already does this via `totalWeight` — keep it).
3. **Body-recomposition recognition.** If bodyweight stalls but body-fat drops, bodyweight score is auto-promoted (recomp credit).
4. **Every input shown on screen must contribute to the score.** No dead inputs.

### New weights (sum = 100%)

| Pillar               | Signal             | Weight |
|----------------------|--------------------|:------:|
| Body composition     | Bodyweight direction | 22% |
|                      | Body fat direction   | 13% |
| Training             | Progressive overload | 20% |
| Nutrition            | Diet compliance      | 18% |
| Recovery             | Sleep                | 10% |
|                      | Stress               | 7%  |
| Activity             | Steps                | 10% |

Pillar split: Body comp 35 / Training 20 / Nutrition 18 / Recovery 17 / Activity 10.

### Tightened threshold tables

**Sleep** (current penalises 7 hrs which is fine for adults):
- 7–9 hrs → 100
- 6–<7 or >9 → 75
- 5–<6 → 45
- <5 → 20

**Steps** (current is fine but add a "gym client" allowance):
- ≥10 000 → 100
- ≥7 500 → 80
- ≥5 000 → 55
- ≥3 000 → 35
- <3 000 → 15

**Overload** (current weighting too punitive on plateaus):
- Improved → 100
- Form refined → 80 (was 75)
- Same → 55 (was 40)
- Regressed → 15

**Recomp credit (new rule):** if body-fat = "drop" AND bodyweight score < 75, promote bodyweight score to 75. Reflects the real-world fact your client raised: scale stalled, fat dropping = working.

---

## 3. Drop-in code patch — paste into `login app.html`

### 3a. Replace `calcTrueScore`, `stepsScore`, `sleepScore`, `overloadScore`

Find the block from `function stepsScore` (line 632) through the end of `calcTrueScore` (line 772) and replace with:

```javascript
// ---------- DevFit scoring v2 (balanced, all-signal) ----------
function stepsScore(s){
  if(s===null) return null;
  if(s>=10000) return 100;
  if(s>=7500)  return 80;
  if(s>=5000)  return 55;
  if(s>=3000)  return 35;
  return 15;
}
function sleepScore(h){
  if(h===null) return null;
  if(h>=7 && h<=9)  return 100;
  if(h>=6 && h<10)  return 75;
  if(h>=5)          return 45;
  return 20;
}
function dotSteps(v){ return v>=10000?'ok':v>=5000?'warn':'bad'; }
function dotSleep(v){ return (v>=7&&v<=9)?'ok':v>=6?'warn':'bad'; }
function dotBW(v){ return v>0?'ok':''; }

function overloadScore(ol){
  if(ol==='improved')  return 100;
  if(ol==='form')      return 80;
  if(ol==='same')      return 55;
  if(ol==='regressed') return 15;
  return null;
}
function bfScore(dir){
  if(dir==='drop') return 100;
  if(dir==='same') return 50;
  if(dir==='rise') return 0;
  return null;
}
function dietScore(d){
  if(d==='met')         return 100;
  if(d==='missed_few')  return 60;
  if(d==='binge')       return 20;
  return null;
}
function stressScore(s){
  if(s==='low')      return 100;
  if(s==='moderate') return 60;
  if(s==='high')     return 20;
  return null;
}

function bwScore(bwAvg, prevBwAvg, goalType){
  if(bwAvg===null) return null;
  const sw = appData.startWeight ? parseFloat(appData.startWeight) : null;
  const tw = appData.goal        ? parseFloat(appData.goal)        : null;
  if(tw!==null){
    if(goalType==='loss'     && bwAvg<=tw) return 100;
    if(goalType==='gain'     && bwAvg>=tw) return 100;
    if(goalType==='maintain' && Math.abs(bwAvg-tw)<=0.5) return 100;
  }
  if(prevBwAvg===null){
    if(sw===null||tw===null) return null;
    const totalGap = Math.abs(tw-sw);
    if(totalGap===0) return 100;
    const done = Math.abs(bwAvg-sw);
    return Math.min(100, Math.round((done/totalGap)*100));
  }
  const diff = bwAvg - prevBwAvg;
  if(goalType==='loss'){
    if(diff<-0.5) return 100; if(diff<-0.2) return 90;
    if(diff<0)    return 75;  if(diff<0.3)  return 50; return 20;
  } else if(goalType==='gain'){
    if(diff>0.5)  return 100; if(diff>0.2)  return 90;
    if(diff>0)    return 75;  if(diff>-0.3) return 50; return 20;
  }
  if(Math.abs(diff)<=0.3) return 100;
  if(Math.abs(diff)<=0.7) return 65;
  return 30;
}

function calcTrueScore(w){
  const ci      = appData.weeklyCheckin[w] || freshCheckin();
  const bwAvg   = avg(appData.bw[w]);
  const prevBw  = w>0 ? avg(appData.bw[w-1]) : null;
  const stepsAv = avg(appData.steps[w]);
  const sleepAv = avg(appData.sleep[w]);
  const gt      = appData.goalType || 'loss';
  const tw      = appData.goal ? parseFloat(appData.goal) : null;

  // 1. Bodyweight raw score
  let bwVal = bwScore(bwAvg, prevBw, gt);

  // 2. Body fat score
  let bfVal = bfScore(ci.bfDir);

  // 3. RECOMP CREDIT — scale stalled but body-fat dropping = working
  if(ci.bfDir==='drop' && bwVal!==null && bwVal<75) bwVal = 75;

  // 4. Target reached overrides
  const targetReached = bwAvg!==null && tw!==null && (
    (gt==='loss'     && bwAvg<=tw) ||
    (gt==='gain'     && bwAvg>=tw) ||
    (gt==='maintain' && Math.abs(bwAvg-tw)<=0.5)
  );
  if(targetReached) bwVal = 100;
  if(targetReached && ci.bfDir==='drop') bfVal = 100;

  // 5. Weighted scores — every visible input now counts
  const scores = {
    bw:     {val: bwVal,                      weight:22, label:'Bodyweight'},
    bf:     {val: bfVal,                      weight:13, label:'Body fat'},
    ol:     {val: overloadScore(ci.overload), weight:20, label:'Overload'},
    diet:   {val: dietScore(ci.diet),         weight:18, label:'Diet'},
    sleep:  {val: sleepScore(sleepAv),        weight:10, label:'Sleep'},
    steps:  {val: stepsScore(stepsAv),        weight:10, label:'Steps'},
    stress: {val: stressScore(ci.stress),     weight:7,  label:'Stress'}
  };

  // 6. Adaptive normalisation — only weight what's logged
  let totalWeight = 0, weightedSum = 0;
  Object.values(scores).forEach(s=>{
    if(s.val!==null){ totalWeight += s.weight; weightedSum += s.val * s.weight; }
  });

  let overall = totalWeight>0 ? Math.round(weightedSum/totalWeight) : null;
  if(targetReached && ci.bfDir==='drop') overall = 100;
  else if(targetReached && overall!==null) overall = Math.max(overall, 95);

  return { overall, scores };
}
// ---------- end scoring v2 ----------
```

### 3b. Fix the misleading legend strip — replace line 375

```html
Score weighted across 7 signals — Bodyweight 22% · Body fat 13% · Overload 20% · Diet 18% · Sleep 10% · Steps 10% · Stress 7%. Untracked signals are skipped and the rest re-normalise automatically.
```

### 3c. Fix the tile legend — replace lines 401–426 (the 6 small grey tiles)

```html
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;">
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Bodyweight 22%</div>
    <div style="font-size:9px;color:#666;">Direction vs goal<br>+ recomp credit</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Body fat 13%</div>
    <div style="font-size:9px;color:#666;">Drop=100 · Same=50<br>Rise=0 · Optional</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Overload 20%</div>
    <div style="font-size:9px;color:#666;">Improved=100 · Form=80<br>Same=55 · Regressed=15</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Diet 18%</div>
    <div style="font-size:9px;color:#666;">Met=100 · Few miss=60<br>Binge=20</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Sleep 10%</div>
    <div style="font-size:9px;color:#666;">7–9h=100 · 6h=75<br>5h=45 · &lt;5h=20</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Steps 10%</div>
    <div style="font-size:9px;color:#666;">10k+=100 · 7.5k=80<br>5k=55 · 3k=35</div>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:7px 8px;">
    <div style="font-size:10px;font-weight:700;color:#111;margin-bottom:2px;">Stress 7%</div>
    <div style="font-size:9px;color:#666;">Low=100 · Moderate=60<br>High=20</div>
  </div>
  <div style="background:#fff7ed;border-radius:8px;padding:7px 8px;border:1px dashed #fb923c;">
    <div style="font-size:10px;font-weight:700;color:#9a3412;margin-bottom:2px;">Recomp rule</div>
    <div style="font-size:9px;color:#9a3412;">If BF drops &amp; weight stalls, bodyweight auto-set to 75</div>
  </div>
</div>
```

---

## 4. Other things worth tightening before you sell it

1. **Per-week consistency bonus** (optional v2): clients who log all 7 days get +5 to the overall score, capped at 100. Drives daily logging which is the real product moat.
2. **Goal-type-aware steps thresholds**: a hypertrophy client lifting 5×/week with 4 000 steps shouldn't be flagged "low" the same as a fat-loss client. Future enhancement: let trainer set step goal per client.
3. **The PDF report (line 1299) prints the overall score but not the breakdown.** For paying clients this should show the full weighted breakdown — adds perceived value.
4. **The "feedback-box" weekly analysis** — currently text-only. For commercial use, add 2–3 specific actionable cues per week (e.g. "sleep dropped to 5.8 h avg — biggest drag on your score this week").

---

## 5. Hosting — keep GitHub Pages? Or move?

**Verdict: GitHub Pages is fine for now, but two upgrades will pay for themselves the moment you sell seat #1.**

| Option | Cost | Pros | Cons |
|---|---|---|---|
| **GitHub Pages (current)** | Free | Reliable, you already use it | URL `deva000000.github.io/DevFit` is unsellable to other trainers, no edge POPs in Asia |
| **Cloudflare Pages** | Free | Faster in Malaysia (CF has Singapore + KL POPs), free unlimited bandwidth, custom domains free, supports Workers if you ever need server logic | Slight learning curve to migrate |
| **Netlify / Vercel** | Free tier | Easy CI/CD | Vercel cold-starts on functions; less generous free tier than Cloudflare |

**Recommended path for commercial launch:**

1. **Buy a domain** — `devfit.my` (~RM80/yr) or `devfit.app` (~USD15/yr). This is the single biggest credibility move. `app.devfit.my/client/<name>` looks like a SaaS, `deva000000.github.io/DevFit` does not.
2. **Move static hosting to Cloudflare Pages.** Connect to the same GitHub repo — every push auto-deploys. Free, faster for Malaysian users, and you get a real CDN.
3. **Keep Apps Script as backend** — that part of your stack is fine and stays free indefinitely.

Migration is a 30-minute job and reversible.

---

## 6. Mobile app icon — why it isn't showing

Your `<head>` has:
```html
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-192.png">
```

Three reasons this fails on mobile:

1. **`icon-192.png` and `icon-512.png` don't exist in the repo** (or aren't at the path the manifest expects). Android Chrome silently falls back to a default globe icon.
2. **No `<link rel="icon">` for the regular favicon** — desktop browsers cache from various sources so it "works" there, but mobile Chrome strictly needs this tag.
3. **`manifest.json` may be missing the icons array** with `purpose: "any maskable"` — required for Android home-screen install.

### Fix — three steps

**Step A.** Create two PNG files from your DevFit logo and commit them to the repo root (same folder as the HTML):
- `icon-192.png` — 192×192 px
- `icon-512.png` — 512×512 px

(Easiest tool: realfavicongenerator.net — upload your logo, download the bundle.)

**Step B.** Replace the icon block in `<head>` (lines 197–202) with:

```html
<link rel="icon" type="image/png" sizes="32x32" href="icon-192.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="icon-192.png">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#cc0000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="DevFit">
<meta name="mobile-web-app-capable" content="yes">
```

**Step C.** Create or replace `manifest.json` in the repo root with:

```json
{
  "name": "DevFit Progress",
  "short_name": "DevFit",
  "description": "Dominance Through Discipline — client progress tracker",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#111111",
  "theme_color": "#cc0000",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

After deploy: on Android, Chrome menu → "Add to Home Screen" will now use your DevFit logo. On iOS, Safari → Share → Add to Home Screen does the same.

---

## Suggested rollout order

1. Apply scoring patch (sections 3a, 3b, 3c) — fixes the credibility bug today.
2. Add icon files + manifest fix (section 6) — 15 min.
3. Buy domain + move to Cloudflare Pages (section 5) — 30–45 min, do this before onboarding any external trainer.
4. Add per-week consistency bonus + PDF breakdown (section 4) — v2, before subscription pricing goes live.

Tell me which section to implement first and I'll produce the patched file ready to drop into the repo.
