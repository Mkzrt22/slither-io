# 🐍 Slither.io — Deployment & Monetisation Guide

## Overview

| Feature | Stack |
|---|---|
| Hosting | Railway (recommended) or Render |
| Payments | Stripe Checkout |
| Ads | Google AdSense |
| Database | None — unlock tokens are HMAC-signed |

---

## Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_NAME/slither-io.git
git push -u origin main
```

---

## Step 2 — Deploy on Railway (free tier, ~$5/mo after)

1. Go to **https://railway.app** → New Project → Deploy from GitHub
2. Select your repo → Railway auto-detects Node.js
3. Set environment variables (see Step 4 first):

```
PORT            = 3000
NODE_ENV        = production
PUBLIC_URL      = https://your-app.up.railway.app   ← set after first deploy
TOKEN_SECRET    = <random 64-char hex string>
STRIPE_SECRET_KEY     = sk_live_...
STRIPE_PRICE_ID       = price_...
STRIPE_WEBHOOK_SECRET = whsec_...
```

4. Generate TOKEN_SECRET locally:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 2 (alternative) — Deploy on Render (free tier available)

1. Go to **https://render.com** → New → Web Service → Connect GitHub repo
2. Build command: `npm install`
3. Start command:  `npm start`
4. Add the same env vars as above
5. Free tier sleeps after 15 min inactivity — upgrade to Starter ($7/mo) for always-on

---

## Step 3 — Google AdSense

### Apply for AdSense
1. Go to **https://adsense.google.com** → Sign up
2. Add your site URL (e.g. `your-app.up.railway.app`)
3. Google reviews the site — approval takes 1–14 days
4. Once approved you get a **Publisher ID** like `ca-pub-1234567890123456`

### Add your IDs to index.html
Search for `ca-pub-XXXXXXXXXXXXXXXX` in `public/index.html` — there are **3 places**:
- The `<script>` tag in `<head>`
- The lobby banner `<ins>` tag (`data-ad-client`)
- The death screen `<ins>` tag (`data-ad-client`)

Also replace `data-ad-slot` values with the slot IDs from your AdSense dashboard.

### Ad units to create in AdSense dashboard
| Placement | Format | Suggested size |
|---|---|---|
| Lobby banner | Display / Horizontal | 728×90 (leaderboard) |
| Death screen | Display | 320×50 (mobile banner) |

### AdSense tips
- Don't click your own ads — instant ban
- The game must comply with AdSense policies (no adult content, violence must be minimal)
- Revenue: typically $0.50–$3 CPM. 10,000 daily impressions ≈ $5–$30/day

---

## Step 4 — Stripe Setup

### Create Stripe account
1. Go to **https://stripe.com** → Create account
2. Complete business verification (can use individual / sole trader)
3. Switch to **Live mode** when ready (start in Test mode)

### Create the $3 product
1. Dashboard → **Products** → Add product
2. Name: `Slither Supporter Pack`
3. Description: `Unlock Gold, Neon, and Galaxy skins forever`
4. Pricing: **One time** · **$3.00 USD**
5. Copy the **Price ID** → `price_1ABC...` → paste into env var `STRIPE_PRICE_ID`

### Get API keys
Dashboard → Developers → API keys:
- **Secret key** → `STRIPE_SECRET_KEY`  
  (starts with `sk_live_` in production, `sk_test_` in test mode)

### Set up webhook
1. Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-app.up.railway.app/api/stripe-webhook`
3. Events to listen to: `checkout.session.completed`
4. Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### Test the flow
Use Stripe test card: `4242 4242 4242 4242`, any future date, any CVC.

---

## Step 5 — Custom Domain (optional)

### Railway
Settings → Networking → Custom Domain → add `slither.yourdomain.com`  
Add a CNAME record in your DNS: `slither → your-app.up.railway.app`

### After adding domain
Update `PUBLIC_URL` env var to `https://slither.yourdomain.com`

---

## Revenue projection

| Daily players | Ad impressions | Ad revenue/day | Skin conversions (2%) | Skin revenue/mo |
|---|---|---|---|---|
| 100 | 300 | ~$0.15 | 2 | $6 |
| 500 | 1,500 | ~$0.75 | 10 | $30 |
| 2,000 | 6,000 | ~$3.00 | 40 | $120 |
| 10,000 | 30,000 | ~$15.00 | 200 | $600 |

---

## How to get players

1. **Reddit**: Post to r/WebGames, r/incremental_games, r/io_games with a GIF
2. **itch.io**: List for free — gets organic discovery
3. **ProductHunt**: Launch on a Tuesday morning
4. **Twitter/X**: Post a screen recording — tag #gamedev #webgames #indiegame
5. **Discord**: Join io-game Discord servers
6. **Newgrounds**: Submit to Flash/HTML5 games section

---

## Security notes

- `TOKEN_SECRET` must be kept secret — it signs all purchase tokens
- Never commit `.env` to git (it's in `.gitignore`)
- Stripe webhook signature verification prevents fake purchase events
- Tokens are HMAC-verified on every game load — can't be forged without the secret
- If a token is stolen and shared: rotate `TOKEN_SECRET` to invalidate all existing tokens

---

## Local development with Stripe

Install Stripe CLI: https://stripe.com/docs/stripe-cli

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe-webhook
# In another terminal:
npm run dev
```

Use test mode keys (`sk_test_...`) and test cards during development.
