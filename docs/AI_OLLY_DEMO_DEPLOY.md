# AI OLLY — Dashboard demo deploy (Vercel staging → aiolly-dev)

Public demo URL for showing a client, from `feature/ai-olly-platform-2`, pointed at the
**aiolly-dev** Supabase project. **Not production**: does not touch Render, `main`,
`DATA_PROVIDER`, the PWA, or any production data. Reversible — delete the Vercel project to undo.

Data = the existing dev demo: synthetic content + a **read-only** copy of Antique Split.
**No real guest PII exists in aiolly-dev.**

---

## 1. Create the Vercel project (once)
1. Push is already on `feature/ai-olly-platform-2`. In Vercel → **Add New → Project → Import** the
   `info513/ai-olly-backend` repo.
2. **Root Directory: `dashboard`** (important — the app lives in a subfolder).
3. Framework preset: **Next.js** (auto-detected). Build/Install commands: defaults.
4. **Production Branch:** set to `feature/ai-olly-platform-2` (so the demo URL tracks this branch).

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)
Set these for **Production** (and Preview). Copy the values from the repo's `dashboard/.env.local`
(they are already there) — **never paste the service-role key into chat or commit it.**

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mcgrccvvybgcozeqlisj.supabase.co` | aiolly-dev (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(from `dashboard/.env.local`)* | anon key — public by design, RLS enforces security |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from `dashboard/.env.local`)* | **server-only**, never `NEXT_PUBLIC_`. Powers consent/private-asset routes |
| `NEXT_PUBLIC_ENVIRONMENT` | `demo` | cosmetic badge only |

Leave **BREVO_* and OPENAI_* unset** → newsletter stays "send disabled", AI preview stays
retrieval-only. The dev-only routes (`/api/newsletter/webhook-dev`, `/api/migration/*`) auto-disable
on Vercel because `assertDevProject()` refuses `NODE_ENV=production` — expected and safe.

## 3. Deploy
Vercel deploys on push. You get a URL like `https://ai-olly-backend-<hash>.vercel.app`.

## 4. Log in for the demo
- URL: the Vercel domain (e.g. `.../home` for hotel workspace, `.../reception`, or `.../platform`).
- Credentials: `demo@aiolly.dev` / `AiOllyDemo!2026`.
- Demo user is **hotel_admin @ Demo Hotel** + **editor @ Antique Split**. Use the top switcher →
  **Demo Hotel** for the full reception/guests/stays/consent flow.
- To also show the **Platform CMS** (destinations/POIs/routes/…), promote the demo user to
  platform_admin once: `update profiles set is_platform_admin=true where email='demo@aiolly.dev';`
  (run from a trusted machine; the Migration tooling still stays disabled on Vercel by the dev-guard).

## 5. Notes / hygiene
- Email/password login works cross-origin — **no Supabase Auth redirect-URL change needed.**
- The public URL is gated by the Supabase login, so only someone with the demo password gets in.
  Optional extra: Vercel **Deployment Protection** (password) on top.
- The demo user can edit Demo-Hotel data during the demo; if you want it pristine afterwards, re-run
  the dev seed scripts, or rotate the demo password (`supabase` dashboard → Auth) after the meeting.
- Teardown: delete the Vercel project. Nothing on aiolly-dev/main/production is affected.

## Quick alternative (no hosting): live tunnel
For a one-off screen-share, `npx cloudflared tunnel --url http://localhost:3100` gives a temporary
public URL from your laptop. Only while running, and it exposes the local dev server (which holds the
service-role key) — fine for a short live demo, not to leave up.
