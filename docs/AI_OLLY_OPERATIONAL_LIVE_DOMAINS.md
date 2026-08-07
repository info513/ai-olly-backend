# AI OLLY — Domain classification: CMS-Published vs Operational-Live

**Status:** LOCKED product decision for RC1 · **Scope:** aiolly-dev / `feature/ai-olly-platform-2` · **Date:** 2026-08-07

An independent review flagged that **Rooms** and **Pricing** do not use the Draft → Publish → Live
workflow that the destination CMS uses. This is **intentional**. The platform has two deliberately
different content classes. This document records the decision so it is not mistaken for a gap.

> Decision: **Do NOT add `published_snapshot` / versioning / a Publish button to Rooms or Pricing for RC1.**
> They are Operational-Live by design. This is documented here rather than "fixed".

---

## The two domains

### 1. CMS-Published domain — Draft → Publish → Live
Canonical, shared, editorially-reviewed content that many hotels read and that must not change under a
guest mid-edit. Every change is staged as a draft and only reaches guests on an explicit **Publish**.

- **Members:** Destinations, POIs, Routes, Whispers, Events, Live Feed, Destination AI Knowledge,
  Newsletter Templates, Hotel Services content, Consent Templates.
- **Mechanism:** the row holds the working draft; `publish_*` RPCs (SECURITY DEFINER, platform/role-gated)
  write a `published_snapshot` + an immutable `content_versions` row; `resolved_*` functions serve the
  snapshot (row fallback). Draft edits never reach hotels/guests before Publish. Rollback restores a prior
  version. Direct `status='published'` is blocked outside the publisher RPCs.
- **Why:** shared/canonical content, editorial safety, auditability, multi-hotel blast radius.

### 2. Operational-Live domain — authorized Save is immediately live
Hotel-operational facts that a hotel maintains for its own guests, where the correct value **is** the current
value and staging would be friction, not safety. An authorized Save takes effect immediately.

- **Members:**
  - **Rooms / Room Guide** — Wi-Fi password, minibar facts, room equipment, AC/TV/safe notes, and other
    operational room information.
  - **Pricing** — price categories / price items (currency, VAT, billing unit, validity); authorized price
    changes go live immediately.
- **Mechanism:** normal authorized writes under RLS. **No Publish button. No `published_snapshot`. No CMS
  draft/live for RC1.**
- **Why:** these are single-hotel operational truths. A guest must see the *current* Wi-Fi password or price,
  not a stale "published" one; there is no editorial-review or cross-hotel-broadcast requirement.

Operational-Live is **not** "unprotected". These retain:
- **Authorization** — RLS + role checks (hotel_admin/editor/marketing as appropriate; platform_admin).
- **Audit** — writes are captured by the audit triggers / `audit_log`.
- **Validation** — column CHECKs, `is_valid_service_body`, price validity/VAT constraints, etc.
- **Hotel isolation** — hotel-scoped RLS; a hotel can never read or write another hotel's rooms/pricing.

What they intentionally do **not** have: draft staging, a published snapshot, version history, or a Publish
step. Adding those to Rooms/Pricing is explicitly **out of scope** for RC1 (and not a Phase-11 blocker).

---

## Quick reference

| Domain | Draft/Publish? | published_snapshot? | Version history? | Live on… |
|---|---|---|---|---|
| Destinations / POIs / Routes / Whispers / Events / Live Feed | ✅ | ✅ | ✅ | Publish |
| Destination AI Knowledge | ✅ | ✅ | ✅ | Publish (critical-ack) |
| Newsletter Templates | ✅ | ✅ | ✅ | Publish (campaign snapshots frozen) |
| Hotel Services (content) | ✅ | ✅ | ✅ | Publish |
| Consent Templates | ✅ | ✅ (frozen text) | ✅ | Publish |
| **Rooms / Room Guide** | ❌ (Operational-Live) | ❌ | ❌ | **authorized Save** |
| **Pricing** | ❌ (Operational-Live) | ❌ | ❌ | **authorized Save** |

Hotel **Presentation** settings (visible/featured/order/recommendation) are a third, lightweight class:
per-hotel overlays on shared CMS content (Pattern B) — also live on Save, and they never edit canonical facts.

---

## Consequence for reviewers

A finding of the form "Rooms/Pricing lack draft/live" is **working-as-intended for RC1**, not a defect. If a
future release needs price scheduling or staged room-guide changes, that is a scoped feature request against
this decision — not a security or integrity gap.
