# Antique Split — AI Migration Report

**Sprint 9 · Part 8.** The 617-row Airtable intent-routing model is **not** migrated 1:1.
Classification produced by `normalize-antique.mjs` (`ai_classification` in the normalized bundle).

## Intent-pattern classification (617 total)

| Class | Count | Meaning / disposition |
|---|--:|---|
| Replaced by structured entity data | 598 | Points at a migrated service; the service now carries the fact (available_to_ai). Phrases retained as candidate aliases. |
| Retained as safe alias | 598 | Same rows — their phrases are captured as `ai_aliases` reference for a curated `knowledge_aliases` import when knowledge articles are authored. |
| Room-deterministic | 5 | Points at a room; handled by the structured room model + deterministic code. |
| Obsolete / drop | 0 | (none had empty phrases) |
| Manual review | 14 | No service/room link — city/disambiguation intents; keep in deterministic code or author as knowledge. |

> The 598 "replaced" and 598 "retained-alias" describe the **same rows** from two angles: the
> fact is now structured data, and the phrasing survives as alias candidates. They are not
> additive.

## AI configuration migrated (→ `ai_configs`, 1 row)

- **Persona / voice** — from HOTELI *Persona Voice* + the 5 AI_CONTEXT scopes (Room Guide,
  Requests, City Guide, General, Hotel), each with tone + do/don't.
- **Response formatting** — active AI_OUTPUT_RULES (format + style per scope).
- **Safe-handoff text** — from AI_FALLBACK (preserved verbatim; the two-tier safe-handoff
  policy remains enforced in code, not data).

## Deterministic facts as data

Room facts (WiFi/AC/TV/Safe/Smart-Glass/welcome) and service facts (check-in/out, breakfast,
etc.) are represented as **structured entity columns/blocks**, not routing phrases — so the AI
resolves them from data rather than a 617-branch pattern table.

## Deliberately NOT migrated

- **AI_RESPONSE_LOGS (1693)** and **UNANSWERED_QUESTIONS (318)** guest-typed text — potential
  incidental PII; used only to *identify* knowledge gaps, never imported verbatim.
- **AI_SLUG_SCOPE** — a v1 provider-routing concern, irrelevant to the Supabase model.

## Recommendation

Author a small set of `knowledge_articles` for the 14 manual-review intents and any high-value
city facts, then import the curated alias subset from `ai_aliases`. Not required for DEV parity;
tracked for the content team.
