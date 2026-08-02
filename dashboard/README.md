# AI OLLY Dashboard — Sprint 1 (Dashboard Shell)

The operating system for hotels. **Sprint 1 builds only the shell** — authentication, app
layout, sidebar, top bar, command palette (⌘K), global search, notifications, user menu, hotel
switcher, environment badge, and a placeholder Home. Everything is **mocked**; no Supabase, Airtable,
or Render connection yet. The modules (Content, AI, Reception, Guests, Assets, Newsletter, Analytics)
are intentionally **not** built — they render a warm "coming soon" surface.

This app is **additive**: it lives in `dashboard/` and touches nothing in the guest PWA (`../pwa`),
the Render server (`../server`), or the database.

## Stack
Next.js (App Router) · TypeScript · Tailwind · shadcn-style Radix primitives · TanStack Query ·
Supabase-Auth-shaped mock · Lucide · Framer Motion (minimal). Styled strictly to
`../docs/AI_OLLY_DESIGN_SYSTEM.md` (dark-mode-first).

## Run
```bash
cd dashboard
npm install
npm run dev      # http://localhost:3100  (any credentials sign you in)
npm run build    # production build
```

## Where the backend plugs in later
Every screen reads through `src/mock/provider.ts`. Swapping that provider's method bodies for real
Supabase calls (RLS-scoped) in a later sprint requires no component changes. Auth is shaped like
Supabase Auth (`src/providers/auth-provider.tsx`).
