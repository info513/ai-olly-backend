# AI OLLY — Platform 2.0 Roadmap

> **This is a roadmap, not an architecture.** It sequences Platform 2.0 into milestones with goals, dependencies, risks, complexity, and outcomes. Detailed design comes later in `docs/SUPABASE_PLATFORM_ARCHITECTURE.md`, only after the discovery questions in `docs/SUPABASE_DISCOVERY.md` are answered.
> **Guardrail:** v1 (`v1.0.0-antique` on `main`) is frozen production. All 2.0 work lands on `feature/ai-olly-platform-2`. The guest PWA behaviour and the frozen contract (see V1 Final Report §12) must be preserved throughout.
> Date: 2026-07-31.

## Guiding principles
- Optimise for **maintainability, clean architecture, scalability** — not speed.
- **No guest-facing regressions.** QR tokens, room links, and PWA behaviour are frozen.
- **Dual-run before cutover** — Airtable stays readable until Supabase is proven per hotel.
- **Render stays** the backend host; Supabase becomes the data/auth/storage layer behind it.
- Each phase ships independently and is reversible.

## Dependency overview (high level)
```
P1 Supabase migration ──▶ P2 Dashboard ──▶ P3 CMS ──▶ P4 AI Knowledge redesign
        │                      │                          │
        └──────────────────────┴──▶ P5 Storage            ├──▶ P9 Vector Search
                                     P6 Reception ─────────┘
                                     P7 Newsletter ──▶ P8 Analytics ──▶ P10 Future integrations
```

---

## Phase 1 — Supabase migration (data layer)
- **Goal:** Stand up Supabase (EU region) as the primary database; migrate the Airtable content + operational model into Postgres; make the Express API read/write Supabase behind the existing endpoints, with Airtable dual-run as a fallback until verified.
- **Dependencies:** Answered discovery (isolation model, tenant hierarchy, migrate-1:1-vs-redesign, historical-data scope); a Supabase project + connection pooling from Render.
- **Risks:** Data-model mismatch (Airtable's loose typing → strict Postgres); breaking the frozen QR/token→room resolution; PII handling (GUESTS/STAYS/PRIVOLE); hidden Airtable Automations.
- **Complexity:** **High** (foundational; touches every endpoint).
- **Expected outcome:** All content + ops served from Supabase behind unchanged API contracts; Airtable still present but no longer the writer; stable IDs preserved so QR/tokens keep resolving.

## Phase 2 — Dashboard (staff application)
- **Goal:** A hotel-staff dashboard (auth + shell + roles) — the future single interface for content and operations.
- **Dependencies:** P1 (data), Supabase Auth, roles/permissions decisions.
- **Risks:** Auth/permission model errors (cross-tenant access); scope creep; hosting/repo decisions (Next.js on Render vs Vercel).
- **Complexity:** **High** (new app + auth + RLS).
- **Expected outcome:** Authenticated, role-aware dashboard with tenant isolation; empty modules ready to be filled by P3–P8.

## Phase 3 — CMS (content editing replaces Airtable)
- **Goal:** Editors manage Room Guide, Services, POI, Routes, Partners, Events, News, and prices in the dashboard — no Airtable. Draft→publish, validation-on-save, media links, audit/history.
- **Dependencies:** P1 (content schema), P2 (dashboard + roles), P5 (storage for media).
- **Risks:** Content-model fidelity vs redesign; non-technical editors need forgiving UX; concurrent-edit conflicts; save-time validation must not block legitimate edits.
- **Complexity:** **High** (many typed content forms + workflow).
- **Expected outcome:** Airtable is fully replaceable for content on the pilot hotel; content has versioning, audit, and publish workflow.

## Phase 4 — AI Knowledge redesign
- **Goal:** Replace the 617-row intent-pattern model with a maintainable knowledge layer (typed knowledge/FAQ + retrieval over the same CMS records staff edit), keeping the deterministic-first handlers and safe-handoff.
- **Dependencies:** P1 (knowledge schema), P3 (CMS as knowledge source), decisions on deterministic-layer retention + persona/output-rule migration.
- **Risks:** Answer-quality regression; losing eval stability; cache-invalidation on content edits; multi-tenant knowledge isolation.
- **Complexity:** **High** (behaviour-critical; must stay eval-green).
- **Expected outcome:** Simpler, editable knowledge model; AI answers sourced from CMS; eval suite rebuilt and green; deterministic contracts preserved.

## Phase 5 — Storage (media)
- **Goal:** All hotel media (hero images, POI/route photos, signatures, future video) in Supabase Storage with per-tenant buckets, public vs private access, and an image pipeline.
- **Dependencies:** P1 (tenant model), P2 (upload UI in dashboard), access-control decisions.
- **Risks:** Access control (public guest media vs private signatures); migrating historical attachments; bandwidth/CDN cost; large media.
- **Complexity:** **Medium**.
- **Expected outcome:** Media served from Supabase; heroes/POIs finally have imagery; signatures stored privately with signed URLs.

## Phase 6 — Reception (operations dashboard)
- **Goal:** Reception module — live requests queue (statuses, assignee, notes), active guests / check-in, consent flow, and notifications, driven by Supabase (Realtime).
- **Dependencies:** P1 (REQUESTS/STAYS/GUESTS/PRIVOLE schema), P2 (dashboard + reception role), decisions on PMS integration + notification channels.
- **Risks:** Replacing Airtable-automation webhooks with Supabase triggers/jobs; real-time reliability; PMS scope; staff auth vs shared device.
- **Complexity:** **Medium–High** (depends on PMS scope).
- **Expected outcome:** Reception works entirely in the dashboard; guest push + staff notifications driven by Supabase; consent flow modernised.

## Phase 7 — Newsletter
- **Goal:** Subscriber/segment/campaign management in the dashboard, with Brevo as the sending relay; consent-linked opt-in.
- **Dependencies:** P1 (subscribers/consent), P2 (dashboard), P6 (consent), Brevo integration decisions.
- **Risks:** GDPR/opt-in compliance; deliverability/sender identity per hotel; Brevo-as-truth vs Supabase-as-truth.
- **Complexity:** **Medium**.
- **Expected outcome:** Hotels build segments and campaigns from consented guests; Brevo sends; stats visible.

## Phase 8 — Analytics
- **Goal:** Dashboards for guest-question volume, unanswered/handoff rate, request response times, feedback scores, and newsletter performance.
- **Dependencies:** P1 (logs/feedback schema), P6 (requests), P7 (newsletter stats).
- **Risks:** Log volume/retention; meaningful vs vanity metrics; query cost at scale.
- **Complexity:** **Medium**.
- **Expected outcome:** Hotels see actionable metrics; platform sees fleet health.

## Phase 9 — Vector search / embeddings
- **Goal:** Add semantic retrieval (pgvector in Supabase, tenant-scoped) as a hybrid with Postgres full-text search, feeding the AI Knowledge layer.
- **Dependencies:** P4 (knowledge model), P1 (pgvector-ready schema), embedding provider/cost decisions.
- **Risks:** Cost of embedding + re-embedding on edits; retrieval quality/chunking; cross-tenant leakage; premature optimisation (this is a *future* capability).
- **Complexity:** **Medium** (schema-ready earlier; pipeline later).
- **Expected outcome:** Better recall on open-ended questions without regressing deterministic accuracy; isolation preserved.

## Phase 10 — Future integrations
- **Goal:** Extensibility — PMS/channel-manager sync, payments/upsells, booking, additional verticals (e.g. Cathedra), white-label/reseller, guest accounts.
- **Dependencies:** All prior phases; per-integration decisions and demand.
- **Risks:** Scope explosion; third-party coupling; multi-vertical schema pressure.
- **Complexity:** **Variable** (per integration).
- **Expected outcome:** Platform scales to 10 → 100 → 1000 hotels and new verticals without redesign.

---

## Sequencing notes
- **P1 → P2 → P3** is the critical path off Airtable. The dashboard (P2) must exist before a hotel's Airtable is retired (P3).
- **P5 (Storage)** can proceed in parallel once P1/P2 exist.
- **P4 (AI Knowledge)** should follow P3 so the AI reads the new CMS as its source of truth.
- **P9 (Vector)** is explicitly a *future* capability — provision the schema during P1/P4, build the pipeline later.
- **Airtable retirement** happens per hotel, only after that hotel is fully served by Supabase + dashboard and verified.

> This roadmap is milestone-level only. No schema, no code, no implementation is committed by this document.
