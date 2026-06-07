# Orbit MVP — Developer Deployment Guide

Estimated time: **3–4 hours** for a developer familiar with these tools.

---

## What You're Deploying

A React + TypeScript frontend (Vite) with a Supabase backend (Postgres + Auth).
No custom backend server required — Supabase handles auth and database directly.

Stack:
- Frontend: React 18, TypeScript, Vite
- Database + Auth: Supabase (Postgres + Row Level Security)
- Hosting: Vercel (frontend) — free tier works
- Fonts: DM Sans via Google Fonts (loaded from CDN, no install needed)

---

## Step 1 — Supabase Setup (~45 mins)

### 1.1 Create project
1. Go to https://supabase.com and sign up / log in
2. Click "New Project"
3. Name it `orbit-mvp`, choose a region close to your users (e.g. US East)
4. Set a strong database password — **save this somewhere**
5. Wait ~2 minutes for the project to provision

### 1.2 Run the database schema
1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click "New Query"
3. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
4. Paste it into the editor and click **Run**
5. You should see "Success. No rows returned" — this is correct

### 1.3 Get your API keys
1. Go to **Settings → API** in your Supabase project
2. Copy these two values — you'll need them in Step 3:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

### 1.4 Enable email auth
1. Go to **Authentication → Providers**
2. Make sure **Email** is enabled (it is by default)
3. Optional: disable "Confirm email" for easier testing (Authentication → Settings → uncheck "Enable email confirmations")

---

## Step 2 — Install Dependencies (~5 mins)

You need Node.js 18+. Check with `node --version`.

```bash
cd orbit-mvp
npm install
```

---

## Step 3 — Environment Variables (~5 mins)

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the two values from Step 1.3:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Step 4 — Run Locally (~2 mins)

```bash
npm run dev
```

Open http://localhost:5173 — you should see the Orbit login page.

**Test it:**
1. Click "Create one" to sign up
2. Enter your name, organisation (e.g. "Celonis"), email, password
3. You should be redirected to the Dashboard
4. The dashboard will be empty — that's correct until data is uploaded

If this works, the app is fully functional. Proceed to deploy.

---

## Step 5 — Deploy to Vercel (~20 mins)

### 5.1 Push to GitHub
```bash
git init
git add .
git commit -m "Initial Orbit MVP"
git branch -M main
```

Create a new **private** repository on GitHub, then:
```bash
git remote add origin https://github.com/your-org/orbit-mvp.git
git push -u origin main
```

### 5.2 Deploy on Vercel
1. Go to https://vercel.com and log in (connect your GitHub account)
2. Click "New Project"
3. Import the `orbit-mvp` repository
4. Vercel will auto-detect Vite — click **Deploy** (no build settings to change)
5. After ~90 seconds, you'll get a URL like `orbit-mvp.vercel.app`

### 5.3 Add environment variables to Vercel
1. Go to your Vercel project → **Settings → Environment Variables**
2. Add both variables from your `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Click **Save** then go to **Deployments** → **Redeploy** (latest deployment)

### 5.3.1 Auth environment changes

Treat all `VITE_AUTH_*` and `VITE_WORKOS_*` changes as release-gated changes. Vite bakes these values into the frontend bundle at build time, so a bad production value is not a runtime toggle.

Required sequence:
1. Set or change the value in the Vercel **Preview** environment first.
2. Deploy a preview build.
3. Smoke-test sign-in, callback, sign-out, and team invitation acceptance on that preview URL.
4. Apply the same value to **Production** only after the preview smoke test passes.
5. Redeploy production and repeat the auth smoke test.

### 5.4 Custom domain (optional)
1. Go to **Settings → Domains** in Vercel
2. Add `app.orbit-treasury.ai` (or whatever domain you own)
3. Follow Vercel's DNS instructions for your registrar

---

## Step 6 — Smoke Tests (~15 mins)

Test each of these on the live URL:

- [ ] Sign up creates an account and redirects to Dashboard
- [ ] Dashboard shows "No exposure data" empty state
- [ ] Navigate to Exposure Ledger — download the CSV template
- [ ] Upload the template CSV — should parse and show preview
- [ ] Import the CSV — exposures appear in the table
- [ ] Navigate to Hedge Positions — click "Add Hedge", fill form, submit
- [ ] Navigate to Coverage Analysis — shows coverage bars
- [ ] Navigate to Reports — generate PDF and Excel downloads
- [ ] Navigate to Settings — edit hedge policy, save

---

## Common Issues

**"Missing Supabase environment variables" error**
→ Check `.env.local` has both variables with no spaces around `=`

**Login works but redirects to blank page**
→ Run `npm run build` locally and check for TypeScript errors

**CSV upload fails**
→ Use the template downloaded from the Exposure page — it has the correct column names

**Vercel deployment succeeds but app is blank**
→ Environment variables not set in Vercel — see Step 5.3

**Supabase RLS error (403)**
→ The SQL migration didn't fully run — re-run it in the SQL Editor

---

## File Structure Reference

```
orbit-mvp/
├── src/
│   ├── components/
│   │   └── layout/AppLayout.tsx    ← sidebar navigation
│   ├── hooks/
│   │   ├── useAuth.tsx             ← login/signup/signout
│   │   └── useData.ts              ← all database queries
│   ├── lib/
│   │   ├── supabase.ts             ← database client
│   │   ├── utils.ts                ← formatting helpers
│   │   └── csvParser.ts            ← Workday CSV parser
│   ├── pages/
│   │   ├── DashboardPage.tsx
│   │   ├── ExposurePage.tsx
│   │   ├── HedgesPage.tsx
│   │   ├── CoveragePage.tsx
│   │   ├── ReportsPage.tsx
│   │   └── SettingsPage.tsx
│   ├── types/index.ts              ← all TypeScript types
│   ├── App.tsx                     ← router
│   └── index.css                   ← design system
├── supabase/
│   └── migrations/001_initial_schema.sql
├── .env.example                    ← copy to .env.local
└── package.json
```

---

## Handoff Notes for CTO

When a CTO joins, the cleanest next steps are:

1. **Workday API integration** — replace CSV upload with OAuth connection to Workday Financials. The `fx_exposures` table schema is already designed for this (has `source_system` and `upload_batch_id` fields).

2. **Real-time FX rates** — replace manual `fx_rates` table entries with a live feed (Open Exchange Rates API ~$12/mo, or Bloomberg if already contracted).

3. **SOC 2 prep** — Supabase has audit logging. Enable it in project settings before the first enterprise customer goes live.

4. **Custom email domain** — Supabase sends auth emails from `noreply@mail.supabase.io` by default. Configure a custom SMTP sender (e.g. `no-reply@orbit-treasury.ai`) in Supabase Auth settings.
