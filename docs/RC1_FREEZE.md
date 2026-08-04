# AI OLLY Platform 2.0 — RC1 Freeze

**Status: RELEASE CANDIDATE 1 — feature-complete.** From this point, work is quality-only and
gated by the RC1 pipeline (`npm run rc1` / `.github/workflows/rc1.yml`). Every change must keep
the gate green.

## 🔒 LOCKED (do not change)

- **Supabase schema** — tables, columns, types.
- **RLS** — policies and the fail-closed tenancy model.
- **Dashboard architecture** — App Router structure, providers, data-layer patterns.
- **UX Bible** — `docs/AI_OLLY_DASHBOARD_UX_BIBLE.md`.
- **Design System** — `docs/AI_OLLY_DESIGN_SYSTEM.md` (tokens, components, primitives).

## ✅ Allowed

- Bug fixes
- Security hardening
- Performance improvements
- Accessibility improvements
- Documentation
- Refactoring (behavior-preserving)

## ⛔ Forbidden

- New modules
- New tables
- New workflows
- New features
- Architecture redesign

## Rules

- All work stays on `feature/ai-olly-platform-2`; **no merge to `main`** until RC1 sign-off.
- Additive-only DB changes (e.g. indexes) are permitted under "performance/security" **without**
  altering schema semantics, RLS intent, or the Design System.
- Any change must pass `npm run rc1` before commit; CI enforces it on push/PR.
