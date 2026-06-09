# DevFit Pricing Page — Setup Guide

**Model:** Single flat tier — **DevFit Pro RM20/month**.
Your own coaching clients = free activation (you add them manually as before).
Anyone else = pays RM20 via DuitNow QR.

---

## 3 things to do before going live

### 1. Generate your DuitNow QR (one-time, ~3 min)
- Open Maybank2u / CIMB Clicks / Public Bank app
- Go to **DuitNow QR → Receive Money → Generate QR**
- Save the QR image (PNG)
- Rename it to **`duitnow-qr.png`**
- Drop it in the same folder as `pricing.html`
- Commit + push to GitHub

> Touch 'n Go eWallet and GrabPay also generate free DuitNow QR codes you can use.

### 2. Link the pricing page from your login page
Open `login.html`, add this near the contact box:

```html
<div style="margin-top:14px;font-size:12px;color:#888">
  Not activated yet? <a href="pricing.html" style="color:#cc0000;font-weight:700;text-decoration:none">Activate Pro →</a>
</div>
```

### 3. Google Sheet — Approved tab
Your existing structure works. When someone pays RM20:
- Add their email + name
- Set plan = `Pro`
- Set start_date = today, expiry_date = today + 30 days
- Status = `active`

For your own clients: same row, just skip the payment check.

---

## When someone pays — your workflow (2 min)

1. WhatsApp ping: screenshot + Gmail
2. Verify RM20 landed in your bank
3. Add row to Approved tab → expiry = today + 30 days
4. Reply: "Activated. Login: https://deva000000.github.io/DevFit/login.html"

---

## Revenue math (RM20 tier)

| Active Pros | Monthly | Yearly |
|---|---|---|
| 10 | RM200 | RM2,400 |
| 50 | RM1,000 | RM12,000 |
| 100 | RM2,000 | RM24,000 |
| 250 | RM5,000 | RM60,000 |

At RM20 you maximize signups (impulse-buy zone) vs. higher tiers that need explaining. Volume play.

---

## Renewal tracker (do this weekly)

In your Sheet, add a `days_left` column:
```
=expiry_date - TODAY()
```

Filter to `days_left < 5` → those need a renewal WhatsApp nudge.

---

## What to do at 100+ active subs (future)

If you hit 100+ paying users, that's when automation makes sense:
- Add **Stripe Malaysia** (3% fee = RM0.60 per sub, worth it at scale)
- Auto-renewal removes the weekly nudge work
- Until then, manual is fine and keeps margins at 100%
