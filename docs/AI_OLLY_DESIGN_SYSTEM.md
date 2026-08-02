# AI OLLY — Design System

**The visual constitution of AI OLLY.** This is not code, CSS, or Tailwind — it is the specification
every future implementation must obey. It defines *what things look and feel like* and *why*. Values
here (colors, sizes, timings) are **design tokens** — the vocabulary — not stylesheet rules.

> Guiding intent, inherited from the UX Bible: AI OLLY must feel like premium hospitality software —
> the *Aman* of hotel tools, not the DMV. Warm, calm, fast, confident. **Dark‑mode‑first** (the
> operational surface), with a light mode planned. The brand is navy‑and‑cream, editorial, quietly
> luxurious.

---

## Part 1 — Brand Personality

AI OLLY should feel:

- **Premium** — every surface signals quality; nothing looks cheap, cramped, or default. The tool a
  hotelier is *proud* to run their property on.
- **Warm** — hospitable, human, editorial. Cream and navy over cold corporate grey. It welcomes, the
  way a good hotel welcomes.
- **Calm** — spacious, unhurried, one clear focus per screen. It lowers a busy receptionist's blood
  pressure rather than raising it.
- **Fast** — visually light, instant‑feeling, no heavy chrome. Speed is a look as much as a metric.
- **Confident** — decisive typography, clear hierarchy, no timid greys‑on‑greys. It knows what
  matters and says so.
- **Luxury hospitality** — the aesthetic of a boutique hotel's brand book, not an enterprise admin
  console. Refined, tactile, considered.

**Anti‑personality (what we reject):** corporate ERP density, SaaS‑grey sameness, dashboard clutter,
loud gradients, playful/childish, or clinical/sterile. If a screen could belong to an accounting suite,
it's wrong.

**Voice in the visuals:** editorial serif for moments that carry brand (display headings, the owner's
one‑line summary), clean humanist sans for work. Restraint everywhere. Color used sparingly and with
meaning.

---

## Part 2 — Visual Principles (and why)

- **Whitespace is structure.** Generous negative space groups, separates, and calms. *Why:* under
  operational pressure, air = clarity; density = anxiety. Space is the cheapest luxury signal.
- **Hierarchy is obvious.** Every screen has one primary thing, supported by a clear second and third
  tier. *Why:* people scan; the eye must land on "what matters now" in under a second (Home's
  five‑second rule).
- **Motion is meaning, not decoration.** Things animate to explain (where a panel came from, that a
  publish succeeded), briefly. *Why:* motion that narrates builds trust; motion for flair erodes speed.
- **Elevation is sparing.** Depth (soft shadow) marks true overlays — dialogs, popovers, the command
  bar. *Why:* if everything floats, nothing does; flatness keeps the surface calm and fast.
- **Cards organize, they don't cage.** Content sits in gently bounded groups, not heavy boxes. *Why:*
  editorial calm — the content is the hero, the card recedes.
- **Borders are quiet.** Hairline, low‑contrast separators over boxes and rules. *Why:* structure
  without noise; heavy borders read as "form/admin."
- **Radius is soft, consistent.** A small family of corner radii (subtle for controls, larger for
  surfaces). *Why:* consistency = craft; softness = warmth; sharp corners feel clinical.
- **Contrast is intentional.** High contrast for the one action that matters, restrained elsewhere.
  *Why:* the primary action should be unmistakable; over‑contrast everywhere is exhausting.
- **Density adapts to the task.** Airy for authoring and glancing; controlled‑dense for reception
  boards and analytics tables that genuinely need it. *Why:* respect the work — a front desk needs
  more per screen than an owner does.

The meta‑principle: **remove until it breaks, then add one thing back.** The default answer to "should
we add this?" is no.

---

## Part 3 — Color System

Dark‑mode‑first. Values are tokens (names are canonical; hexes are the reference). Two brand anchors
(navy, cream/gold), a neutral ink/surface scale, and a restrained semantic set. Each color earns its
place by meaning.

### Brand
| Token | Reference | Use |
|---|---|---|
| `brand.navy` | `#1A3445` | Primary brand surface accent; active nav, brand headers |
| `brand.navy.deep` | `#14222D` | App background base (dark), deepest panels |
| `brand.navy.soft` | `#22455A` | Hover/pressed brand states, subtle brand fills |
| `brand.cream` | `#E8D4A0` | Primary accent / highlight; the "gold" of the brand |
| `brand.cream.soft` | `#F1E6C7` | Text on navy for editorial warmth, subtle accents |
| `brand.gold.deep` | `#C6A55C` | Accent on light surfaces, focus glow on cream |

### Neutrals (dark‑mode ink & surface ladder)
| Token | Reference | Use |
|---|---|---|
| `surface.base` | `#10191F` | App background |
| `surface.raised` | `#16232C` | Cards, panels |
| `surface.overlay` | `#1C2E39` | Popovers, dialogs, command bar |
| `surface.sunken` | `#0C141A` | Wells, code/preview backgrounds |
| `border.subtle` | `#243642` | Hairline separators, card edges |
| `border.strong` | `#334A58` | Input borders, focused dividers |
| `ink.primary` | `#F4F7F9` | Primary text (near‑white, warm) |
| `ink.secondary` | `#AEC0CC` | Secondary text, labels |
| `ink.tertiary` | `#6E828F` | Muted/meta, placeholders |
| `ink.disabled` | `#475866` | Disabled text/icons |

### Semantic (used *only* for meaning, never decoration)
| Role | Token | Reference | Meaning |
|---|---|---|---|
| Primary action | `action.primary` | `#E8D4A0` (cream) on navy | The one main action |
| Info | `info` | `#5AA9E6` | Neutral information, links, AI‑neutral |
| Success | `success` | `#4FB286` | Published, resolved, sent, healthy |
| Warning | `warning` | `#E0A94B` | Attention soon, drafts, expiring, gaps |
| Danger | `danger` | `#E5695B` | Critical, failed, destructive, expired |
| AI confidence | `ai.confident` | `#4FB286` / `ai.handoff` `#E0A94B` / `ai.unknown` `#6E828F` | AI answer state |

Each semantic color has a **soft tint** (≈12% surface) for backgrounds of banners/badges and a
**strong** variant for text/icons — so a warning banner is amber‑tinted, not amber‑flooded.

### Backgrounds / cards / surface guidance
- Page = `surface.base`; content cards = `surface.raised`; true overlays = `surface.overlay` with a
  soft shadow + subtle border. Never stack more than two elevation levels visible at once.
- Preview surfaces (guest/AI render) use `surface.sunken` to read as "a window into another app."

### Typography colors
- Default body `ink.primary`; secondary meta `ink.secondary`; muted `ink.tertiary`. Cream
  (`brand.cream.soft`) reserved for brand/editorial text on navy, never for long body copy.

### Dark mode / Light mode
- **Dark mode is primary and complete now** (all tokens above). It suits long operational sessions and
  the premium editorial mood.
- **Light mode (future)** mirrors the same token *names* with a warm‑paper base (`surface.base ≈ #FAF7F0`
  cream‑white), navy text, and cream→`brand.gold.deep` for accents so the primary action stays legible.
  Semantic hues shift only in lightness. Components must consume tokens, never raw values, so light mode
  is a token swap — no redesign.

---

## Part 4 — Typography

Two families do the work: **Fraunces** (editorial serif, brand/display) and **Geist** (humanist sans,
UI/body), with **Geist Mono** for code/IDs‑as‑data. Fraunces carries warmth and hospitality; Geist
carries speed and clarity.

| Style | Family / Weight | Size / Line‑height | Use |
|---|---|---|---|
| Display | Fraunces, 500–600 | 34–44 / 1.1 | Brand moments, owner summary, empty‑state hero |
| H1 (page title) | Fraunces, 500 | 26–28 / 1.2 | Page/section titles |
| H2 | Geist, 600 | 20 / 1.3 | Card/section headings |
| H3 | Geist, 600 | 16 / 1.4 | Sub‑headings, list group titles |
| Subtitle | Geist, 500 | 15 / 1.5 | Supporting lines under titles |
| Body | Geist, 400 | 14–15 / 1.6 | Default reading/editing text |
| Body‑strong | Geist, 500–600 | 14–15 / 1.6 | Emphasis within body |
| Caption / Meta | Geist, 400–500 | 12–13 / 1.45 | Timestamps, labels, table meta |
| Overline / Label | Geist, 600, tracked +6% | 11–12 / 1.3, uppercase | Field labels, status eyebrows |
| Mono | Geist Mono, 400 | 12–13 / 1.5 | Content in preview code blocks, tokens‑as‑data |

**Weights:** 400 (body), 500 (medium/labels), 600 (headings/emphasis). Avoid 700+ except rare display.
**Letter‑spacing:** slightly negative on large Fraunces display (−1%), neutral on body, +6% tracked on
overlines. **Line‑height:** generous (1.6) for body/editing, tight (1.1–1.2) for display. **Measure:**
body copy capped ~68–72 characters for readability. Numerals: tabular in tables/analytics for aligned
columns.

---

## Part 5 — Layout

A calm three‑zone shell: a quiet **sidebar**, a light **top bar**, and a spacious **page** with a
context **right rail** when detail/history is relevant.

- **Sidebar** (left, ~240px, collapsible to ~64px icons): hotel switcher at top, module nav (icon +
  label, active item marked with a cream accent + navy fill), account at bottom. Quiet by default;
  never the visual focus. Collapses on smaller screens into a drawer.
- **Top bar** (~56px): breadcrumbs / page title on the left, universal search center, ⌘K hint,
  notifications + environment badge (Dev/Prod) + avatar right. Thin, unobtrusive, sticky.
- **Page**: max content width ~**1200px** for reading/authoring, centered, with comfortable gutters
  (24–32px). Analytics/tables may go **full‑bleed** to ~1440px when data warrants. Vertical rhythm on
  an 8px base.
- **Section**: titled bands separated by whitespace and hairline borders, not boxes. A section has a
  title, optional action, and its content.
- **Cards**: `surface.raised`, radius `lg`, subtle border, internal padding 16–20px. Grouped in grids.
- **Grid**: a 12‑column responsive grid, gutter 24px. Home cards typically 4/6/12‑col; editor is a
  fixed two‑pane (content 60% / preview 40%) that stacks on narrow screens.
- **Responsive rules:** ≥1280 full shell; 1024–1280 sidebar collapses to icons; <1024 (tablet)
  sidebar becomes a drawer, two‑pane editor stacks (content over preview), reception boards optimize
  for touch; <640 (phone) single column, bottom‑anchored primary actions, glance‑first.

Spacing scale (tokens): 4, 8, 12, 16, 24, 32, 48, 64. Radii: `sm` 6, `md` 10, `lg` 14, `xl` 20, `full`.
Elevation: `e0` none, `e1` card (soft 1px + faint shadow), `e2` overlay (larger soft shadow), `e3`
dialog (deepest). Never exceed `e3`.

---

## Part 6 — Cards

One card anatomy (title row · body · optional footer/action), specialized by role. All share
`surface.raised`, `lg` radius, `border.subtle`, and consistent padding.

- **Info card** — neutral content grouping. Title + body. The default.
- **Metric card** — one big tabular number, a label, and a small trend/sparkline + delta. For Home &
  Analytics. The number is the hero; the label whispers.
- **Status card** — a state with a colored status pill (Draft/Live/Expiring) and one action. Used for
  "drafts waiting", "critical expiring".
- **Analytics card** — a titled chart (trend/bar) with a legend and a "last refreshed" line; formula
  version shown where relevant so numbers are trustworthy.
- **Action card / Quick action** — an icon, a verb label, opens a focused flow ("New request",
  "Upload media"). Compact, tappable.
- **Warning / Alert card** — semantic soft‑tint background (amber/red), an icon, a message, and a fix
  action. Used sparingly; more than two on a screen means the screen is failing.
- **Preview card** — a framed window rendering the *actual* guest/AI output on `surface.sunken`,
  labeled "Guest view" / "AI view". Reads as a screen‑within‑a‑screen.
- **Empty card / Empty state** — centered, warm illustration + a friendly line + a primary action
  ("No open requests — nice. Log one if you need to."). Never a blank void.

Cards never nest more than one level. A card is a group, not a container hierarchy.

---

## Part 7 — Buttons

Clear intent, one primary per view. Sizes: `sm` (28–30px), `md` (36–38px, default), `lg` (44px, mobile
/ hero). Radius `md`. Icon + label spacing 8px. Focus ring uses `brand.gold.deep` glow.

- **Primary** — cream fill on navy text (or navy fill/cream text in light mode), the single most
  important action on a screen (Publish, Save, Send). Never two on one view.
- **Secondary** — subtle surface fill with `border.strong`, `ink.primary` text. Supporting actions.
- **Ghost** — no fill, `ink.secondary` text, hover reveals a faint surface. Tertiary/low‑emphasis.
- **Danger** — `danger` fill (or outline for less‑destructive), reserved for irreversible/destructive
  acts (there are almost none — history protects us). Always paired with a confirm.
- **Icon button** — square, ghost by default, for toolbars and dense rows; always has an accessible
  label/tooltip.
- **Floating action (FAB)** — mobile/reception only, bottom‑right, primary color, for the one dominant
  "create" action on a touch board.
- **Toolbar button** — compact ghost/segmented group in editor toolbars (block editor, table
  controls).
- **Split button** — a primary action + a caret for variants ("Publish" / "Publish & notify",
  "Schedule" / "Send now"). Used where a clear default plus close alternatives exist.

States for all: default, hover (subtle lift/tint), active/pressed, focus‑visible (ring), loading
(spinner replaces label, width locked to avoid jump), disabled (`ink.disabled`, no shadow). Buttons
never reflow layout between states.

---

## Part 8 — Forms

Forms should feel like filling in a beautiful document, not a bureaucratic form. Label above field,
generous spacing, inline help, forgiving validation.

- **Text input / Textarea** — `surface.sunken` fill or transparent with `border.strong`; clear focus
  (border → `brand.gold.deep` + soft ring); label above (overline style), helper/error below.
  Textareas auto‑grow.
- **Select / Combobox** — same field styling, chevron, searchable when >7 options; opens an
  `surface.overlay` popover with keyboard nav. Multi‑select shows removable chips.
- **Upload** — a dashed drop‑zone with icon + "drag or browse", shows type/size limits inline; on drop,
  a progress row per file, then a ready thumbnail. Ties into the DAM (§12).
- **Date / Time** — a calendar/clock popover; presets ("Today", "Tomorrow 09:00") first; timezone shown
  where it matters (campaign scheduling), never ambiguous.
- **Toggles / Checkboxes / Radios** — for visibility flags and 3‑state (inherit/true/false) fields the
  editor shows a distinct **"Inherit"** state visually (a dim, dotted control) so "inherited vs set" is
  never a guess.
- **Validation** — inline, real‑time but gentle: validate on blur/submit, not on every keystroke;
  errors in `danger` with a human message ("Enter a valid email"), never a code; success confirmations
  are quiet (a check, a toast). Required fields marked subtly; the form explains before it scolds.
- **Field help** — a small caption or an info tooltip; complex rules (segment builder) get a live
  preview instead of prose.

Forms are chunked into sections with whitespace, submit is a single clear primary, and destructive form
actions (discard) are ghost/quiet.

---

## Part 9 — Tables

Tables are for genuine lists (guests, requests, subscribers, analytics) — used deliberately, styled to
stay calm even when dense.

- **Anatomy:** a light header row (`ink.secondary`, overline‑ish, sticky), hairline row separators (no
  vertical grid lines), comfortable row height (44–52px), zebra *only* if density is high. Tabular
  numerals for numeric columns.
- **Status columns** use pills, not raw text. Names and human values only — **never a UUID or raw ID**.
- **Sorting:** click header, clear arrow, one sort at a time; sensible default per table (requests by
  urgency+recency, guests by arrival).
- **Filtering:** a filter bar above with chips (status, type, date range, "AI‑visible"); active filters
  visible and removable; a search box scoped to the table. Empty‑filter result shows a helpful "no
  matches, clear filters" state.
- **Bulk actions:** row checkboxes reveal a floating action bar ("3 selected → Archive / Assign / Tag")
  with only the *safe* bulk operations for that table and role; destructive bulk acts confirm.
- **Row interaction:** whole row is clickable to open detail (right rail or page); a trailing overflow
  menu holds secondary actions. Hover raises the row subtly.
- **Density modes:** comfortable (default) and compact (reception/analytics power use), user‑toggled.
- **Specialized:** Requests read as a board *or* table (toggle); Analytics tables pair with a chart;
  Guests table gates PII columns by role (contact columns simply absent for editors/marketing).

Pagination or virtualized infinite scroll for long lists; never load everything and never freeze the
UI. Column layout is stable; loading uses row skeletons.

---

## Part 10 — AI Components

The AI's signature surfaces — the product's differentiator — get bespoke, trustworthy components.

- **AI Preview (chat)** — a clean conversation on `surface.sunken`, guest bubbles vs AI bubbles,
  a room/locale selector, and a **mode switch** (Published ↔ Preview). Each AI reply carries a small
  **route chip** (Deterministic / Knowledge / Handoff) and expandable **sources** (the articles used,
  linked). Feels like testing a real concierge.
- **AI Diff** — before/after of how the AI answers a question *because of a content change*: two
  answer bubbles side‑by‑side with changed sources highlighted. Shown pre‑publish for knowledge/services.
- **AI Quality** — meaning‑first cards: a big "Confidently answered 94%" with a supporting ring/gauge,
  a handoff‑rate trend, unanswered trend, latency/tokens as secondary. Green when healthy, amber when
  drifting. The formula + version are one tap away.
- **AI Coverage** — a ranked gap list; each gap = a theme, a count, and a "Write answer" primary. A
  progress meter shows the backlog shrinking. This screen should feel *satisfying* to clear.
- **Unanswered Questions** — a deduped stream (redacted, PII‑free), each with occurrence count, assign,
  and "resolve by linking article".
- **Confidence indicator** — a small, consistent visual language: `ai.confident` (green dot/"answered"),
  `ai.handoff` (amber/"handed off"), `ai.unknown` (grey/"no data"). Used in preview, logs, quality.
- **Knowledge Source chip** — a pill showing which article/scope (hotel/destination/platform) the AI
  used, clickable to jump to that article. Makes "why did it say that?" a one‑click answer.

Tone of these components: transparent and reassuring. They exist to prove *the AI never invents facts*
and to make improving it feel like progress, not chores.

---

## Part 11 — Publishing

Publishing is a recognizable, identical experience everywhere — a small ceremony that scales with risk.

- **Draft badge** — a quiet amber‑tinted pill "Draft"; the working state, never seen by guests.
- **Preview** — a segmented toggle Guest view / AI view rendering the *real* output; the truth before
  it's real.
- **Publish sheet** — a bottom sheet / dialog summarizing **what changed** (a readable diff since last
  version), a validity check, and — for **critical** content — a required acknowledgement checkbox
  ("I confirm this is correct"). Primary "Publish" button; on success, a green "Live in guest app" toast.
- **Rollback** — from History, "Restore this version" → creates a **new draft** (never destroys),
  clearly labeled, then re‑publish. Framed as safe and normal.
- **History drawer** — a right‑rail timeline of versions (who, when, change summary), each openable;
  select two to see a **Diff**.
- **Diff view** — readable before/after: added/removed/changed content highlighted (success‑green
  additions, danger‑red removals, subtle change markers), block‑level for structured content.
- **Approval (optional workflow)** — a "Submitted for review" state pill; a reviewer sees a review
  banner with Approve/Request changes. Layered on the same version machinery; visual only, no new
  concepts for the user.

The visual promise: **Draft and Live are never confusable**, every publish shows its consequences, and
the past is always one drawer away.

---

## Part 12 — Asset Manager (DAM)

A tactile media library that treats assets as governed, reusable objects.

- **Upload** — the drop‑zone pattern (§8) with clear per‑type limits and allow‑listed types; live
  progress; on finalize, a rich thumbnail with captured dimensions/size. Public vs private destination
  is explicit; private items are badged.
- **Gallery** — a responsive masonry/grid of preview cards (image/video/doc/audio, each with a
  type icon and status), filterable by type/scope/status/health. Selection for bulk tagging/archiving.
- **Preview** — a focused lightbox: image with transform sizes (thumbnail/card/hero/full), video embed
  (Vimeo/YouTube/clip), PDF via secure link. Metadata panel (alt text, rights/credit, dimensions).
- **Usage ("where used")** — a panel listing every place the asset appears (room hero, POI card,
  newsletter header, consent PDF) with links. The card that prevents accidental deletion.
- **Replace** — creates a new revision and re‑points usages; a before/after comparison; history intact.
- **History** — versions/revisions of an asset and its metadata changes; archived assets live in a
  Trash with restore; delete is **blocked while in use** (the UI says so, and offers "detach first").

Health cues surface right in the gallery: badges for "unused", "missing alt", "missing rights" — the
same signals Analytics counts.

---

## Part 13 — Navigation

Multiple ways to move, all fast; search and ⌘K are primary for power users.

- **Sidebar** — module list with icons + labels; active item marked (cream accent bar + soft navy
  fill); collapsible; hotel switcher pinned top, account bottom. Quiet, learnable, stable order.
- **Command palette (⌘K)** — an `surface.overlay` panel: fuzzy search across things *and* actions,
  grouped (Jump / Create / Act / Go to), recent‑first, role‑aware, keyboard‑only operable. The fastest
  path for everyone; visually it's the app's "Raycast".
- **Universal search** — the top‑bar field; same engine as ⌘K, results grouped by kind ("Rooms",
  "Guests", "Do…"), each opening the thing. Often replaces menu navigation entirely.
- **Breadcrumbs** — for depth (Content ▸ Rooms ▸ 201 ▸ Room Guide); clickable, truncating gracefully;
  the current level is `ink.primary`, ancestors `ink.secondary`.
- **Tabs** — within a detail (a room's Guide / Overrides / Media / History); underline‑style, one
  active, keyboard‑navigable; used for sibling views of one thing, never for unrelated navigation.
- **Quick actions** — contextual primary buttons + the Home quick‑action cards + the FAB on touch.
  Always the "one obvious next step".

Navigation never surprises: the same thing is always in the same place, deep links are shareable, and
back always works.

---

## Part 14 — Notifications

Graded, quiet by default, always a door to action (mirrors the UX Bible's five tiers).

- **Toast** — transient, bottom‑right, for **success** (green, "Published to guests") and light info;
  auto‑dismiss ~4s; stackable, never more than a few; a toast never blocks work.
- **Banner** — persistent, in‑context strip at the top of a page/section for **warnings** (amber:
  "This content expires in 3 days") or **info** (grey), with an inline fix action; dismissible where
  appropriate.
- **Dialog** — modal, focus‑trapping, for **decisions/confirmations** (publish critical, discard, bulk
  destructive). One primary + one cancel; escape/backdrop closes safe ones; never used for mere info.
- **Critical warning** — the loudest tier: a red banner or a modal for genuine emergencies (a critical
  fact expired, a campaign failed, the AI is contradicting itself). Insistent but not panicky; always
  offers the fix.
- **Notification center** — a top‑bar bell with grouped, dismissible items (Tasks/Warnings/Info/
  Success), unread marker, each linking to the source. Reception's request nudges live here — gentle,
  not alarms.

Rule made visible: **notify to enable action, never for attention's sake.** A busy day never becomes a
red wall.

---

## Part 15 — Loading

Loading should feel instant or, when it can't, honest and calm.

- **Skeletons** — the default for content areas (cards, tables, editor): shape‑matched shimmer at low
  contrast so the layout doesn't jump when data lands. Never a centered spinner on a big empty page.
- **Progress** — determinate bars for uploads and long jobs (campaign scheduling, analytics refresh)
  with a real percentage/step; indeterminate slim top‑bar for route transitions.
- **Inline/button loading** — a small spinner replaces a button's label (width locked), so actions feel
  responsive without layout shift.
- **Empty state** — distinct from loading: a warm illustration, a friendly line, and a primary action.
  Encouraging, never a blank void ("Nothing here yet — create your first article.").
- **Error / Retry** — a calm state (not a red crash): a short human explanation, a Retry, and a way
  out. Errors from the server are translated to plain language, never raw codes. Partial failures (a
  publish that half‑succeeded) explain what happened and what's safe to do.

Optimistic UI is the norm: actions feel instant and reconcile with the server; if the server disagrees
(a permission), the UI gently corrects and explains.

---

## Part 16 — Animations

Motion is brief, purposeful, and consistent — it narrates, never performs.

- **Durations:** micro (hover, toggles) ~120ms; standard (panels, popovers, toasts) ~200ms; large
  (dialogs, page/pane transitions) ~280–320ms. Nothing slower than ~350ms in normal use.
- **Curves:** standard ease‑out for entrances (fast‑in, settle), ease‑in for exits, a gentle
  spring only for the command palette and success confirmations (a touch of delight). No bounce on
  routine UI.
- **Hover:** subtle — a 1–2px lift, a faint tint, a border brighten. Never a big scale jump.
- **Transitions:** panels/right‑rail slide from their origin (history drawer from the right); popovers
  scale‑fade from their trigger; tabs cross‑fade content, the underline glides.
- **Modal:** backdrop fades, dialog scales up slightly from center (~0.98→1) with the shadow settling.
- **Page:** quick cross‑fade / slight vertical slide between routes; never a heavy slide that feels slow.
- **AI Preview:** the AI reply "types in" briefly (or fades in with a subtle thinking indicator) to
  feel alive, then the route chip and sources settle in.
- **Publishing:** the publish sheet rises; on success, a small satisfying check‑morph + the green
  "Live" toast — a moment of earned delight for a meaningful action.

All motion respects `reduced‑motion` (see §17): it degrades to instant cross‑fades/opacity, never
removing meaning, only movement.

---

## Part 17 — Accessibility

Non‑negotiable; premium *is* accessible.

- **Keyboard:** everything operable without a mouse — full tab order, ⌘K to reach any action, escape to
  close, arrow‑key nav in menus/tables, enter to activate. Reception can run the desk on keys alone.
- **Focus:** a clear, consistent focus‑visible ring (`brand.gold.deep` glow) on every interactive
  element; focus is trapped in dialogs and returned on close; never removed for aesthetics.
- **Contrast:** meet **WCAG AA** — body text ≥4.5:1, large text/UI ≥3:1 — against its surface, in both
  modes. The cream‑on‑navy primary and semantic tints are all tuned to pass.
- **Screen readers:** semantic structure (landmarks, headings, lists, labeled controls), meaningful
  alt text (assets *require* it — the DAM flags missing alt), status changes announced via live regions
  (a new request, a publish success), tables with proper headers/scope.
- **Targets:** touch targets ≥44px on tablet/phone; adequate spacing between them.
- **Reduced motion:** honor the OS setting — swap movement for instant/opacity transitions; the AI
  "typing" becomes an instant reveal; nothing essential depends on animation.
- **Language/locale:** the product is multi‑locale aware (content locales); UI text is localizable;
  numbers/dates format per locale.
- **Color independence:** never rely on color alone — status pills carry text/icons, the AI confidence
  states carry labels, diffs carry markers as well as color.

---

## Part 18 — DOs & DON'Ts

**DO**
- Do lead every screen with one clear primary action.
- Do use whitespace as the first tool for hierarchy.
- Do use color only for meaning (semantic set), sparingly.
- Do show names, rooms, and human values — always.
- Do keep Draft/Live and Dev/Prod unmistakable at a glance.
- Do translate errors into human language.
- Do make the AI's sources and confidence visible.
- Do respect reduced motion and keyboard users.
- Do keep the same thing in the same place, always.
- Do make empty states warm and actionable.

**DON'T**
- Don't expose database concepts (tables, rows, RLS, foreign keys) anywhere.
- Don't ever show a UUID or raw ID to a user.
- Don't use more than **one** primary button per view.
- Don't use more than **two** accent/semantic colors on a single screen.
- Don't stack more than two elevation levels or nest cards deeper than one.
- Don't overload a screen — if it needs a scroll of dense boxes, it's two screens.
- Don't create hidden actions (right‑click‑only, mystery gestures); discoverable or in ⌘K.
- Don't gate with mysterious greyed‑out controls — if a role can't do it, don't show it.
- Don't animate for flair or exceed ~350ms; never block on motion.
- Don't show raw error codes, spinners on full empty pages, or layout that jumps on load.
- Don't rely on color alone to convey state.
- Don't let it look like an admin panel or enterprise ERP — ever.

---

## Output — Summary

**Estimated design tokens:** ~**180–220** total —
- Color ~70 (brand 6, neutral/ink 12, semantic × soft/strong/tint ~24, AI/state ~10, mode‑paired overrides for light ~18).
- Typography ~30 (families 3, weights 3, ~11 roles × size/line/tracking).
- Spacing 8, radii 5, elevation 4, border/opacity ~8.
- Motion ~14 (durations 4, curves 4, named transitions ~6).
- Z‑index/layout ~8, iconography sizing ~4. (One canonical token set consumed by every component; light
  mode is a value swap, not new tokens.)

**Estimated reusable UI components:** ~**120–160** — a core kit (~40: button family, inputs, select,
textarea, checkbox/toggle/3‑state, upload, date/time, dialog, sheet, popover, tooltip, tabs, table
primitives, pill/badge, card shells, skeleton, toast, banner, avatar) plus signature patterns (~50:
StatusPill, PublishSheet, HistoryDrawer, DiffView, PreviewPane [Guest/AI], AIChat, RouteChip,
ConfidenceDot, KnowledgeSourceChip, CoverageList, KpiCard, TrendChart, GaugeRing, BlockEditor + block
types, MediaPicker, UsagePanel, SegmentRuleBuilder, AudienceCount, RequestTimeline, ConsentCapture,
CommandBar, SearchResults, CapabilityNav, HotelSwitcher, EnvBadge, EmptyState) and module compositions.

**Estimated page templates:** ~**10–12** archetypes that all ~60–80 screens inherit — App Shell, Home
(priority list), List/Table, Detail + right‑rail, Two‑Pane Editor (content/preview), Analytics
Dashboard, DAM Gallery, Chat/AI, Wizard/Flow (campaign, onboarding), Settings, Empty/Error, Auth.

**Estimated interaction patterns:** ~**18–22** — Edit→Preview→Publish→History, rollback‑as‑new‑draft,
critical‑ack confirm, inherit/override toggle, command‑palette do‑anything, universal search‑to‑act,
optimistic write + reconcile, filter‑chips + bulk‑action bar, drag‑drop upload + finalize, "where used"
inspect, segment rule‑build + live count, request board/timeline, consent capture/sign, notification →
action, skeleton‑first loading, reduced‑motion fallback, role‑gated reveal, hotel/env switching.

**Estimated icon set:** ~**140–180** icons from a single consistent line family (Lucide‑style, 1.5px
stroke, 20/24px) — nav (12), content types (10), actions (30), status/semantic (12), AI (10), media
types (12), reception/guest (14), analytics (10), form controls (12), misc/utility (30). One family,
one stroke weight, no mixing.

**Recommended illustration style:** sparse, warm, editorial line‑art with a single brand accent
(cream/navy), used almost exclusively for **empty states** and onboarding — hospitality motifs (a key,
a door, a concierge bell, a room) rendered minimally. Never stocky, never cartoonish, never busy. A few
bespoke spot illustrations, not a sprawling library.

**Recommended image style:** real, high‑quality hospitality photography — natural light, warm tones,
architectural and human, editorial (think a boutique hotel's website), never generic stock. Consistent
treatment (subtle warm grade), rounded corners, respectful of the navy/cream palette. Hotel/room/POI
media is the hotel's own; platform imagery sets the tone.

**Recommended empty‑state philosophy:** *never a void, always a doorway.* Every empty state is warm,
brief, and actionable — a small illustration, a human line that reframes emptiness positively ("No open
requests — nice work."), and one primary action to fill it. Empty states are onboarding: they teach the
product by inviting the first action.

**Recommended animation philosophy:** *motion narrates, then gets out of the way.* Brief (≤~320ms),
purposeful, consistent — it explains where things come from and confirms meaningful actions (a publish
earns a small moment of delight), never decorates or delays. Fast by default, delightful at the few
moments that matter, invisible everywhere else, and fully degradable for reduced motion.

---

*End of Design System. No React, CSS, Tailwind, or implementation was created. This document is the
visual constitution; every future build must conform to it. Awaiting review.*
