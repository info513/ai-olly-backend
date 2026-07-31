# Supabase Setup Guide (for Ivan)

> Click-by-click, non-technical. This creates the **development** Supabase project only. It does **not** touch production, Airtable, the Render production service, or the guest app.
> After each step, save the values into a password manager. **Never paste secrets into files that get committed to git.**
> Date: 2026-07-31.

## Before you start
- You need: a web browser and your password manager.
- You will create: one **development** project (we can add staging/production later).
- Time: ~15 minutes.

---

## 1. Create the Supabase organization
1. Go to **https://supabase.com** → **Start your project** / **Sign in** (GitHub or email).
2. If prompted, **create an organization**. Name it something like **`AI OLLY`**.
3. Choose the **Free** plan for development (we upgrade production later).
   - *Why:* the org is the billing + team container for all AI OLLY projects.
   - *Who:* you (you'll be the owner).

## 2. Create the development project
1. Click **New project**.
2. **Name:** `aiolly-dev`.
3. **Organization:** the `AI OLLY` org from step 1.
   - *Why:* a dedicated dev project keeps experiments away from production.

## 3. Select the EU region
1. In the project form, set **Region** to an **EU** location — **Frankfurt (eu-central-1)** is a good default.
   - *Why:* GDPR (guest data stays in the EU) and low latency to Split.
   - This **cannot be changed later** — pick EU now.

## 4. Choose and save the database password
1. The form asks for a **Database password**. Click **Generate a password** (strong).
2. **Immediately copy it into your password manager** labelled `aiolly-dev DB password`.
   - *Why:* it's needed for migrations/tooling and can't be shown again in full.
3. Click **Create new project** and wait ~2 minutes for it to provision.

## 5. Find the keys and connection details
Open the project, then:
1. **Project URL** — **Settings → API → Project URL** (looks like `https://<ref>.supabase.co`). *Public, but save it.*
2. **anon key** — **Settings → API → Project API keys → `anon` `public`**. *Public; used later by the dashboard.*
3. **service-role key** — same page → **`service_role` `secret`**. **SECRET — server-only. Never share, never commit, never put in a browser app.**
4. **Database connection string** — **Settings → Database → Connection string** (URI). Save it (contains the password).

Save all four in your password manager (e.g. a `aiolly-dev` entry).

## 6. Store secrets safely
- Put the values in your **password manager**, not in any document, chat, email, or committed file.
- Distinguish:
  - **Public:** Project URL, anon key.
  - **Secret:** service-role key, database password, connection string.

## 7. Add development secrets to your local `.env`
On the machine where the code runs (dev only):
1. Copy `.env.example` to `.env` (if you don't have one yet): the repo's `.env` is **gitignored**, so it's safe.
2. Fill in (server-only) — **example placeholders, use your real values**:
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role secret>
   SUPABASE_DB_URL=<connection string>
   SUPABASE_DB_PASSWORD=<db password>
   DATA_PROVIDER=airtable
   ```
   - Keep `DATA_PROVIDER=airtable` — the app must keep running on Airtable.
   - *Why:* the connection test reads these; the app itself still uses Airtable.

## 8. (Later) Add secrets to Render
- **Only when we're ready to use Supabase on the server.** In the Render dashboard → your service → **Environment** → add the same `SUPABASE_*` variables.
- *Why:* Render is the server; it needs the secrets at runtime. **Do not** add them yet if we're not using them — and never add the service-role key anywhere a browser can read it.

## 9. Link the Supabase CLI to the project (developer step)
This is done by the developer (Claude Code), not you — noted here for completeness:
- Install the CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`) and Docker Desktop.
- `supabase login`, then `supabase link --project-ref <ref>` (dev project), then `supabase db push` to apply the foundation migration.

## 10. Test the connection
- Developer runs: `npm run check:supabase`.
- Expected: `✓ Supabase reachable. platform_health() -> {...}`.
- It writes no data and reveals no secrets. If it says a variable is missing, revisit step 7.

## 11. Confirm nothing production changed
- **Airtable:** untouched and still live.
- **Production Render service / domain:** untouched.
- **Guest PWA:** untouched.
- This whole guide only created a new **dev** Supabase project and stored keys.

---

### What to send back / confirm
Once done, tell the developer: **"aiolly-dev created, EU region, keys saved."** Do **not** paste the service-role key or DB password into chat — the developer will pull them from your local `.env` / Render when needed.
