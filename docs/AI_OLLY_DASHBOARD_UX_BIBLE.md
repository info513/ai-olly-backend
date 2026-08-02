# AI OLLY — Dashboard UX Bible

**This is not a technical document.** It defines how *people* use AI OLLY — the feeling, the flow, the
work. Screens exist because a human needs them, never because a table exists. Read this before any
pixel is drawn. It is the source of truth for experience; the master plan is the source of truth for
structure.

> The test for every screen in AI OLLY: *"Whose job does this make easier, and by how many seconds?"*
> If we can't answer, the screen doesn't ship.

---

## Part 1 — Who Uses AI OLLY?

Six people use AI OLLY today (two more are coming). Each has a different reason to open it, a
different pace, and a different definition of "good."

### Platform Admin — *the AI OLLY operator*
- **Responsibilities:** onboard hotels, curate shared destination content, keep the platform healthy,
  step in across tenants when needed.
- **Goals:** every hotel launches fast and stays high‑quality with minimal hand‑holding.
- **Daily workflow:** scan a portfolio of hotels by health, unblock the ones that are stuck, publish
  destination/platform defaults, answer escalations.
- **Pain points:** context‑switching between hotels, spotting a struggling hotel before it complains.
- **Success metric:** hotels live and healthy; low support load; high AI coverage across the portfolio.

### Hotel Owner — *the investor*
- **Responsibilities:** none operational; wants outcomes.
- **Goals:** know the hotel is running well, guests are happy, and the AI is earning its keep — in one
  glance, from a phone, occasionally.
- **Daily workflow:** opens rarely, expects an answer instantly. "Are we good?"
- **Pain points:** dashboards that demand interpretation; being told numbers instead of meaning.
- **Success metric:** confidence. Fewer questions to the manager. A calm green screen.

### Hotel Manager (General Manager) — *the owner of the operation*
- **Responsibilities:** the whole hotel — content, staff, quality, guests, reputation.
- **Goals:** a smooth day with no surprises; the AI helps guests so staff can focus; content is always
  current.
- **Daily workflow:** morning health check → clear what needs attention → coach the team → review AI
  quality and feedback → publish the important changes.
- **Pain points:** finding out about a problem from a bad review instead of from the tool; not knowing
  what's a draft vs live; being afraid to change something.
- **Success metric:** fewer guest complaints, higher ratings, staff who trust the system, zero "the AI
  said something wrong" incidents.

### Reception — *the front line*
- **Responsibilities:** arrivals, departures, requests, feedback, consent, keeping guests happy in
  real time.
- **Goals:** handle every guest need fast, never drop a request, never look unprepared.
- **Daily workflow:** who's arriving, who's leaving, what's open, what's urgent — all day, at speed,
  often on a tablet at the desk.
- **Pain points:** juggling paper/WhatsApp/memory; forgetting a request; hunting for guest info;
  clumsy tools during a rush.
- **Success metric:** zero missed requests, fast acknowledgement/resolution, calm front desk.

### Marketing — *the storyteller*
- **Responsibilities:** newsletters, promotions, the hotel's media and news, engagement.
- **Goals:** send beautiful, well‑targeted campaigns to the right, consented audience — without
  engineering help.
- **Daily workflow:** build media, write a campaign, pick an audience, preview, schedule; watch how the
  last one performed.
- **Pain points:** consent uncertainty, ugly templates, not knowing who to send to, dependency on
  developers.
- **Success metric:** open/click rates, list growth of *consented* subscribers, campaigns shipped
  self‑serve.

### Content Editor — *the keeper of truth*
- **Responsibilities:** rooms, services, FAQ/knowledge, POI presentation — the facts the AI speaks.
- **Goals:** the hotel's information is complete, correct, and the AI answers confidently.
- **Daily workflow:** fix the gaps the AI surfaced, update what changed, preview the guest and AI
  experience, publish safely.
- **Pain points:** not knowing what's missing; fear of breaking the live guest app; no way to preview.
- **Success metric:** AI coverage up, unanswered questions down, no stale/expired content.

### Coming later — *Maintenance* and *Housekeeping*
- **Maintenance:** turn "AC not working in 201" into a ticket, fix it, close the loop with reception.
- **Housekeeping:** room‑ready board, turnaround status. Both reuse the request/timeline experience so
  they feel native from day one.

**The through‑line:** each persona wants *less software, more done*. AI OLLY wins when a manager stops
thinking about the tool and just runs the hotel.

---

## Part 2 — One Day in the Hotel

A real working day, described as *work*, not as pages.

**07:00 — Reception opens.** The night was quiet. Reception opens AI OLLY on the desk tablet. The
screen already knows what today is: **five arrivals, three departures, two open requests from
overnight** (one guest asked about early check‑in via the AI at 02:00; the AI handed off politely, and
it's waiting). Reception acknowledges both in two taps, replies to the early‑check‑in guest, and
glances at who's arriving.

**08:00 — Breakfast rush, first guests.** A guest in 204 messages the AI: "What time is breakfast?"
The AI answers instantly and correctly (07:00–10:30) — reception never sees it, and that's the point.
A different guest asks something the AI doesn't know ("Do you have a gluten‑free menu?"). The AI hands
off; a gentle notification appears at reception. Reception answers the guest and, in one click, turns
that unanswered question into a note for the editor.

**09:00 — Manager's morning check.** The manager opens AI OLLY with coffee. The home screen is a
priority list, not a wall of charts: *AI answered 94% confidently yesterday · 2 drafts waiting · 1
critical item expiring · feedback average 4.7 · 3 open requests.* Thirty seconds and they know the
state of the hotel. They clear the two drafts (an editor's updated pool hours, a new spa service),
acknowledge the manager on the critical item, and move on.

**10:00 — Editor fixes a gap.** The editor opens the AI's "Coverage" view. Top unanswered theme this
week: *gluten‑free / dietary*. They write a short knowledge article, preview how the AI will now answer
it, and publish. The next guest who asks gets a confident answer — no deploy, no developer.

**11:00 — A price change.** The manager decides to raise the airport transfer to €45. They open
Services → Transfer, change the price, preview both the guest card and the AI answer, and publish with
one acknowledgement (it's guest‑facing money, so AI OLLY asks them to confirm). Live in seconds; the
old price is in history if anyone asks.

**12:00 — Check‑outs.** Reception checks out three guests. Two leave feedback via the AI (5★ and a
follow‑up request about a lost charger); reception sees the follow‑up immediately and handles it.

**13:00 — Marketing builds a campaign.** Marketing drafts a "Summer at Demo Hotel" newsletter in the
same editor the editors use. They pick the "English‑speaking subscribers with active consent" audience
— AI OLLY shows the live count (312) and quietly guarantees nobody without consent is included. They
preview, schedule for Thursday 09:00, and leave. Nothing sends yet; the moment it's scheduled, the
content is frozen.

**14:00 — Maintenance (today: reception logs it).** A guest reports the AC in 201 is weak. Reception
opens the guest's stay, sees the room, checks the Room Guide's AC instructions (maybe it's just the
eco mode), tries the quick fix on the phone with the guest, then logs a request assigned to
maintenance. The whole thread lives in one place.

**16:00 — Manager reviews quality.** The manager looks at AI Quality for the week. Coverage is up
since the dietary article shipped; handoffs are down. They see reception's average acknowledgement
time is 4 minutes — great — and note one repeat question about parking they'll ask the editor to
address.

**18:00 — Arrivals continue.** Two late arrivals check in. The AI has been answering their pre‑arrival
questions in the PWA all afternoon. Reception captures marketing consent for one guest who opted in,
from a published template, signed on the tablet.

**20:00 — Wind down.** Reception scans open requests — all resolved. The manager's phone shows a calm
summary. The owner, at dinner across town, glances once: green. Nobody thought about "the software"
all day. That's success.

---

## Part 3 — Tasks (forget modules, think jobs)

People don't do "modules." They do tasks. Every task below is a first‑class flow in AI OLLY, reachable
in one action from the command bar:

- Guest is arriving today → prepare / check in
- Guest is checking out → check out, invite feedback
- Guest requests a pillow / towels / late checkout → log & route
- Guest loses WiFi → answer instantly (AI) or reception fixes
- Guest reports AC/TV/safe not working → triage → maintenance
- Guest asks something the AI can't answer → answer → capture as a gap
- Guest leaves feedback / a bad rating → acknowledge → follow up
- Reception captures marketing consent → sign from published template
- Reception prints / re‑sends a consent record → retrieve signed copy
- Manager changes a price (minibar, transfer) → edit → preview → publish
- Manager updates check‑in time → edit critical → acknowledge → publish
- Editor updates the Room Guide (WiFi, breakfast) → edit → preview → publish
- Editor answers a recurring question → write knowledge → preview AI → publish
- Editor adds a new service → author → set visibility → publish
- Editor features a POI for guests → toggle presentation, add hotel tip & photo
- Marketing sends a campaign → template → audience → preview → schedule
- Marketing grows the list → import consented subscribers
- Marketing publishes hotel news / an event → author → publish
- Manager reviews AI quality → read the week → assign fixes
- Manager checks knowledge completeness → clear the backlog
- Owner asks "are we good?" → open, glance, close
- Manager invites a new staff member → add → assign role
- Manager rolls back a mistake → open history → restore as draft → re‑publish
- Anyone finds anything → search "Room 201", "Breakfast", "Guest John"

Notice: not one of these is named after a table. They're named after moments.

---

## Part 4 — Workflows

Complete flows for the moments that matter. Each is designed to feel like a single, guided motion —
never a scavenger hunt.

**1. "The AC isn't working in 201."**
Reception opens the guest (or the room) → sees the active stay and the Room Guide's AC section →
tries the quick fix with the guest ("it may be on eco mode") → if unresolved, logs a request assigned
to maintenance with priority → the thread starts a timeline → maintenance fixes → reception replies to
the guest (guest‑visible) with a private internal note beside it → resolve → close. One place, one
thread, nothing lost.

**2. "What time is breakfast?" (the AI handles it)**
Guest asks in the PWA → AI answers from published knowledge instantly → reception never involved. If
breakfast hours changed, the editor updated them once; the AI was correct the moment it published.
*The best workflow is the one a human never touches.*

**3. "The AI didn't know something."**
Guest asks → AI hands off gracefully → reception gets a soft nudge and answers the guest → one click
"turn into a knowledge gap" → it appears in the editor's Coverage list, deduped with others → editor
writes the answer → previews the AI → publishes → the gap closes and the next guest gets a confident
answer.

**4. "Raise the airport transfer to €45."**
Manager → Services → Transfer → change price → preview guest card + AI answer → Publish → because it's
guest‑facing money, AI OLLY asks for one acknowledgement → live in seconds → old price kept in history.

**5. "Change check‑in to 14:00." (critical content)**
Manager edits the check‑in fact → AI OLLY flags it as **critical** → preview → Publish requires an
explicit "I confirm this is correct" → published, versioned, and the change is in the audit trail. No
critical fact ever changes silently.

**6. "Update the Room Guide WiFi password."**
Editor → Rooms → the room type (shared default) or a specific room (override) → AI OLLY visibly shows
which fields are inherited vs overridden → change → preview the resolved Room Guide exactly as the
guest sees it → publish.

**7. "Guest is arriving today."**
Reception → Today → the arrival → check in → the room becomes "occupied" → the AI now greets that guest
by room context → optional: capture consent, note preferences.

**8. "Guest is checking out."**
Reception → Today → departure → check out → AI OLLY invites feedback → any follow‑up request the guest
leaves lands back at reception instantly.

**9. "Capture marketing consent."**
Reception → the guest → Consent → pick a **published** template (only published can be signed) → guest
signs on the tablet → the exact text is snapshotted forever → later template edits never change this
signed record → the signature/PDF are private, retrievable only through a secure link.

**10. "Revoke a consent."**
Reception → the consent → Revoke → it's marked revoked with a timestamp; the original signed record is
preserved untouched. Newsletters stop targeting that person automatically.

**11. "Send the summer newsletter."**
Marketing → new campaign → pick template → pick audience (live consented count shown) → Preview →
Schedule → the content freezes → on send day the server does the sending → results flow back into the
campaign. Reception cannot do this; the tool simply never offers it to them.

**12. "Feature the Palace for our guests."**
Editor → Destination → POI → the Palace (shared, locked canonical facts) → toggle "featured", add the
hotel's own tip ("five minutes from our lobby, go early"), attach a hotel photo, set walking time →
publish presentation. The shared facts stay shared; the hotel's flavor is layered on top.

**13. "A guest gave us 2 stars."**
Reception/manager sees it immediately in Feedback → acknowledge → if follow‑up requested, open a
request → resolve → the guest feels heard, and the manager sees the pattern in analytics.

**14. "Onboard a new hotel." (platform_admin)**
Create hotel → assign an admin → seed destination content → the hotel admin invites staff → editors
fill the content the AI Coverage view highlights as missing → preview → go live. The Coverage backlog
*is* the onboarding checklist.

**15. "I made a mistake — undo it."**
Anyone with rights → open the item's History → see every version and who changed what → restore a prior
version as a new draft → review → publish. Nothing is ever truly lost.

**16. "Add a new staff member."**
Manager → Settings → Staff → invite by email → choose a role → they log in and see *exactly* what that
role allows — no more, no less.

Dozens more follow the same DNA: **find the moment → see the relevant context → act → preview → confirm
→ done, with history.** Master the pattern once and every workflow feels familiar.

---

## Part 5 — Home Screen (priorities, not widgets)

The home screen answers one question in **five seconds**: *"What needs me right now?"* It is a
prioritized list of living concerns, role‑aware, each a link to the fix — not a gallery of charts.

What a **manager** sees first: *3 open requests (1 urgent) · 2 drafts waiting · 1 critical item
expiring · AI answered 94% yesterday · feedback 4.7 · newsletter went out, 38% open.* Each line is the
door to the action.

What **reception** sees first: *today's arrivals & departures · open requests, urgent pinned · new
feedback · consent to capture.* Built for a glance during a rush.

What an **editor** sees first: *drafts waiting · top unanswered questions · content expiring · assets
missing info.* The backlog, ranked.

What an **owner** sees: one calm sentence and a color. *"Demo Hotel is running well. Guests are happy
(4.7). The AI handled 94% of questions."* Green. Done.

Rules: every number is a link, never a dead stat. Empty states are warm ("No open requests — nice
work."). Nothing here requires interpretation — AI OLLY does the thinking and tells you the *meaning*.

---

## Part 6 — Content Experience

Updating content should feel like editing a beautiful document, not filling a form. The universal
motion — **Edit → Preview → Preview AI → Publish → History** — is the same everywhere, so learning it
once means knowing the whole product.

**Editing "breakfast":** the editor searches "breakfast" (⌘K), lands directly in the breakfast service,
and sees a clean two‑pane view — the content on the left (written in a friendly block editor: a
paragraph, a bullet list of hours, a callout for dietary notes), a **live preview** on the right
showing exactly how the guest will see it. No fields named after columns; no jargon.

**Preview:** toggle "Guest view" to see the PWA card. It looks like the phone. This is the truth.

**Preview AI:** toggle "AI view" and ask, "What time is breakfast?" — the AI answers *from this draft*.
The editor sees precisely how the concierge will respond after publishing, and which knowledge it used.
This is the moment editors fall in love: they can *test the AI before guests do*.

**Publish:** one button. AI OLLY shows a short summary of what changed since last time. If the content
is critical (money, safety, check‑in), it asks for a single confirmation. Publish is instant — no
deploy, no waiting, no developer.

**History:** every version is there — who, when, what changed — with a readable before/after. If a
change was wrong, restore it as a draft and re‑publish. Editors work *fearlessly* because the past is
always recoverable.

The same experience covers rooms, services, FAQ, news, POI presentation. Inherited vs overridden
fields are shown visually (a lock for shared, editable for yours), so nobody is ever confused about
what they're allowed to change.

---

## Part 7 — AI Experience

The AI is not a mysterious box; it's a teammate the hotel *coaches*. AI OLLY makes that coaching a
daily, satisfying loop.

**AI Preview** — a chat where staff talk to the concierge *as a guest in a chosen room*, in **Published**
mode (what guests get now) or **Preview** mode (including drafts). Every answer shows *how* it answered
— a confident hotel fact, or a graceful handoff — and *what it used*, so an editor can jump straight to
the source. This is "try before you publish."

**AI Quality** — the week in plain language: *"The AI answered 94% of questions confidently. It handed
6% to reception. Coverage is up since Tuesday."* Trends, not raw dumps. The manager reads it like a
report card and knows exactly where to push.

**Knowledge Coverage** — the gap map. The top things guests asked that the AI couldn't answer,
grouped and ranked. Each gap has a one‑click "write the answer." This screen turns real guest confusion
into a to‑do list that shrinks visibly as editors work.

**Missing Answers (Unanswered)** — the raw stream of what guests wanted and didn't get, deduped, PII‑
free. Assign one to a teammate; close it by linking the article that now answers it.

**Broken Knowledge** — the health alarm: critical facts that expired, articles missing translations,
content with no supporting media, published facts that contradict a draft. AI OLLY watches so nobody
has to.

The promise, visible everywhere: **the AI never invents hotel facts.** If a fact isn't published, the
AI won't guess — it hands off. So the way to make the AI smarter is not prompt‑hacking; it's writing
one more good answer. AI OLLY makes that the easiest thing in the product.

---

## Part 8 — Reception Experience

Reception is the highest‑pressure seat in the hotel. AI OLLY's reception experience is built for
**speed, calm, and never dropping a ball** — usable one‑handed on a desk tablet.

**Today** is home: arrivals and departures for the day, big and clear; check‑in/check‑out in a tap; who's
in which room right now. No hunting.

**Requests** is a live board: new / acknowledged / in progress / resolved. Urgent ones rise to the top.
Open one and see the whole story — the timeline of what happened, a place to reply to the guest, and a
*separate* place for internal notes the guest never sees. New requests arrive in real time with a
gentle nudge, never a jarring alarm.

**Tasks** is "my open things" — the requests assigned to me, due soon, one place to not forget.

**Feedback** shows how guests felt, newest first, with follow‑ups flagged so a 2★ becomes a saved
relationship instead of a bad review.

**Consent** is dignified and safe: capture a signature from a published template on the tablet, retrieve
a signed copy through a secure link, revoke without destroying the record. No legal guessing, no loose
PDFs.

**Messages / Notifications** keep reception aware of what the AI handed off, what guests need, and what
just changed — quietly, in context.

Everything reception touches respects privacy: they see the guest details they need; roles that
shouldn't see contact info simply don't. The experience never makes them feel like they're operating
a database — it feels like a very good front‑desk assistant.

---

## Part 9 — Marketing Experience

Marketing should feel like a modern creative tool, not an email server console. Self‑serve, beautiful,
and *consent‑safe by design*.

**Campaigns:** compose in the same lovely block editor the editors use — subject, preview text, content,
a hero image from the media library. Preview the actual email. Pick an audience. Schedule. On schedule,
the content **freezes** — later edits can never alter a campaign that's already going out. Sending
happens server‑side; marketing never touches credentials and *cannot* accidentally blast the wrong
list.

**Assets:** a real media library — drag in images and video (or embed Vimeo/YouTube), tag them, and
reuse them everywhere. AI OLLY always knows *where each asset is used*, so nothing gets deleted out from
under a live page.

**Subscribers:** consent is first‑class. Every subscriber shows their consent status; audiences *always*
exclude anyone without active consent, automatically. There is no "email everyone who ever stayed"
button — because that's not how trust works, and AI OLLY won't build the shortcut.

**Segments:** a guided builder — "English‑speaking guests," "subscribed with active consent" — with a
**live count** as you build. Powerful, but never a raw query box. Marketers feel capable, not dangerous.

**News & Events:** publish hotel news and highlight events with the same Draft→Preview→Publish comfort as
content.

**Analytics:** how the last campaign did — opens, clicks, unsubscribes — and list growth over time. Clear
enough to guide the next send.

---

## Part 10 — Manager Experience

The manager doesn't want a database; they want a **hotel that runs itself as much as possible** and a
clear view when it doesn't. Their experience is *management by exception*.

They open AI OLLY and, in thirty seconds, know the truth: what needs attention, what's drafted, what's
live, how the AI is doing, how guests feel. They spend their time on the few things that matter — a
price to approve, a critical fact to confirm, a coaching note for the team — not on hunting through
tabs.

They can change anything important themselves, safely: edit, preview (guest *and* AI), publish. They can
undo anything. They can see who changed what and when. They can invite staff and set roles without a
developer. They can look at feedback and quality and *lead* with data instead of guessing.

The manager's north star in AI OLLY: **no surprises.** They find out about problems from the tool, not
from a review. Everything important is reversible, so they act with confidence. The hotel feels *in
control*.

---

## Part 11 — Owner Experience

The owner wants **answers, not forms.** Their entire experience is one screen, on a phone, that says —
in a human sentence and a color — how the hotel is doing.

*"Demo Hotel is running well this week. Guests are happy (4.7★). The AI answered 94% of questions on its
own. Two things need the manager's attention."* Green.

No charts to interpret, no menus to learn. If they want more, one tap deepens the story; if not, they
close the app reassured. The owner should never feel they need training to check on their investment.
The best owner session lasts eight seconds and ends in calm.

---

## Part 12 — AI OLLY Philosophy

The beliefs behind every decision. When in doubt, these win.

- **No hidden information.** If it affects a guest or a decision, it's visible and findable.
- **One click less.** The default number of steps for any task is "one fewer than you'd expect."
- **Everything searchable.** If it exists, ⌘K finds it. No memorizing where things live.
- **AI before documentation.** The first way to answer a guest is the AI; the Dashboard exists to make
  the AI right.
- **Preview before Publish.** You always see exactly what guests and the AI will get, before it's real.
- **No deployment for content.** Publishing a fact is instant. Words are not code releases.
- **Every important change is reversible.** History protects everyone; nobody edits in fear.
- **The AI never invents hotel facts.** Unpublished means unspoken. Handoff beats hallucination.
- **One source of truth.** A fact lives in one place; everything else reads from it.
- **Trust over control.** Because everything is versioned and role‑scoped, we can let people *do* things.
- **Calm over dense.** One clear action beats ten crowded ones.
- **Show meaning, not just numbers.** "94% answered" over a raw bar chart.
- **Privacy is not optional.** Guest data is sacred; roles see only what they must.
- **The tool disappears.** Success is a manager who forgets they're using software.

---

## Part 13 — Search

Search is the spine. One field, everywhere, that understands the hotel's world.

Type **"Room 201"** → the room, its guide, its current guest, its open requests. Type **"Breakfast"** →
the breakfast service, the related knowledge, the AI's current answer. Type **"Transfer"** → the service
*and* its price. Type **"Guest John"** → John's stay, requests, consent (if you're allowed to see him).
Type **"Minibar"**, **"Newsletter"**, **"Palace"**, **"WiFi"** → straight to the thing.

Search returns *things and actions*, grouped and human ("Rooms," "Services," "Guests," "Do…"). It
respects your role — you never see a result you couldn't open. It's fast enough to be the primary
navigation: many power users will barely touch the menu. Recent items and smart suggestions make the
common case instant. **If you can name it, you can reach it.**

---

## Part 14 — Command Palette (⌘K)

⌘K is how experts fly. It's search + every action, from anywhere, without lifting hands from the
keyboard.

Press ⌘K and:
- **Jump:** "Room 201", "Breakfast", "Guest John" → go there.
- **Create:** "New request", "New article", "New campaign", "Upload media", "Invite staff".
- **Act:** "Publish breakfast", "Check in 201", "Preview AI", "Roll back check‑in time".
- **Navigate:** "AI Quality", "Today", "Subscribers".

It's context‑aware (in a room, "Publish" means this room), role‑aware (it never offers what you can't
do), and forgiving (fuzzy matching, recent‑first). Reception can run the desk from ⌘K; a manager can
publish a price without ever touching a menu. The palette is not a power‑user luxury — it's the fastest
path for everyone, quietly teaching the product's whole vocabulary.

---

## Part 15 — Notifications

Notifications respect attention. They're graded, quiet by default, and always actionable — never noise.

- **Critical (red, insistent):** a critical fact expired; the AI is contradicting itself; a campaign
  failed to send. These interrupt, because they must.
- **Warning (amber):** knowledge gap trending up; content expiring soon; an asset broke a live page;
  unusually slow AI. "Look soon."
- **Task (blue):** a request assigned to you; a draft awaiting your approval; a consent to capture.
  "Your turn."
- **Info (grey):** a teammate published a change; a campaign was scheduled; daily summary ready.
  Ambient awareness.
- **Success (green):** published to guests; campaign sent; issue resolved. A small, satisfying
  confirmation — the product feeling good.

Every notification is a door to the thing. Reception's request nudges are gentle, not alarms.
Notifications are grouped and dismissible; a busy day never becomes a red wall. The rule: **notify to
enable action, never to demand attention for its own sake.**

---

## Part 16 — Mobile Experience

AI OLLY is used on three surfaces, and each has a job.

- **iPad (the front desk):** the reception hero. Big touch targets, Today front and center, one‑hand
  request handling, consent signing on glass. This is where AI OLLY lives all day; it must feel like a
  purpose‑built desk assistant, not a shrunk website.
- **Laptop (managers, editors, marketing):** the full workshop. Two‑pane editing with live preview,
  history diffs, analytics, the command palette in full flight. The deep‑work surface.
- **Phone (managers on the move, owners):** the glance. The home priority list and the owner's one‑line
  answer; approve a draft, acknowledge a request, read feedback, from anywhere. Not the place to author
  a long article — the place to *stay in control* between meetings.

Responsive isn't "the same page, smaller." Each surface leads with the task that surface is for. The
experience is continuous — start a reply on the tablet, finish on the laptop — but never generic.

---

## Part 17 — Premium Experience (why it must not feel like an admin panel)

AI OLLY competes with the feeling of good consumer software, because the people using it live in
Apple, Instagram, and Uber all day. An "admin panel" feel signals *cheap, hard, not for me*. A premium
feel signals *trustworthy, capable, mine*. That feeling is not decoration — it's adoption. Staff use
tools they like; they route around tools they dread.

- **Apple:** restraint and clarity. One obvious action per screen. Nothing shouts. Space is a feature.
- **Linear:** speed and keyboard mastery. Instant everything; ⌘K as a way of life; no spinners you
  notice. Fast software feels respectful of your time.
- **Notion:** calm, document‑like editing. Content is the hero; chrome recedes; writing feels pleasant.
- **Raycast:** the command palette as a superpower — the whole app a keystroke away.
- **Stripe:** trustworthy density done right — when there *is* a lot of information, it's beautifully
  organized and never overwhelming.

**Why it matters:** a reception clerk under pressure needs an interface that stays calm so *they* stay
calm. A manager needs to trust what they publish — trust comes from polish and predictability. An
owner judges the whole operation by the one screen they see. Premium is the difference between a tool
people tolerate and a tool people are proud to run their hotel on. AI OLLY should feel warm and
editorial (its navy‑and‑cream, Fraunces‑lettered brand), fast as thought, and quietly luxurious — the
Aman of hotel software, not the DMV.

---

## Part 18 — Things We Must Never Do

The blacklist. Breaking any of these breaks the product's soul.

- **Never expose database concepts.** No "tables," "rows," "records," "foreign keys," "RLS." People run
  hotels, not schemas.
- **Never show a UUID or a raw ID.** Ever. Humans see names, rooms, guests — never `a7f3…`.
- **Never require five clicks for a common task.** If it's daily, it's one or two.
- **Never edit production blindly.** No change reaches a guest without a preview and (for critical
  facts) a confirmation.
- **Never let content changes require a deployment.** Words are not releases.
- **Never make the AI invent hotel facts.** Unpublished = unspoken; handoff, never guess.
- **Never duplicate information.** One source of truth; no copy that can drift.
- **Never lose history.** Nothing is unrecoverable; rollback is always available.
- **Never leak guest PII across roles.** Editors/marketing never see contact details; nobody sees
  another hotel's data.
- **Never surface secrets.** Tokens, signatures, keys, endpoints stay invisible.
- **Never blast a non‑consented list.** Consent filtering is not optional and not skippable.
- **Never let one role do another's job by accident.** Reception can't send campaigns; the tool doesn't
  even offer it.
- **Never show raw error codes.** "Reception can't publish campaigns," not `42501`.
- **Never confuse Draft and Live, or Dev and Prod.** Always unmistakable which is which.
- **Never punish exploration.** Users should feel safe clicking around; nothing dangerous is one
  accidental tap away.
- **Never make someone read a manual.** The product teaches itself through good defaults, empty states,
  and the command palette.
- **Never be slow where it's noticed.** Perceived speed is a promise.
- **Never be ugly.** Ugliness erodes trust; this runs a hotel.

---

## Output — Summary

**Estimated dashboard complexity:** a **premium, multi‑tenant hotel operating system** — large in
surface but coherent because one lifecycle (Edit → Preview → Preview‑AI → Publish → History) and one
search/command spine repeat everywhere. Complexity is *managed by consistency*, not by feature count.
Comparable in polish ambition to Linear/Notion; in scope to a focused vertical SaaS, not an ERP.

**Estimated workflows:** ~**40–50** named, first‑class workflows (16 fully designed here, the rest
sharing the same DNA), spanning reception, content, AI, marketing, management, ownership, and
platform onboarding.

**Estimated screens:** ~**60–80** experience surfaces (list/detail/editor per content type, the
reception boards, the AI coaching views, the DAM, newsletter, analytics dashboards, settings,
platform), unified by shared chrome so they feel like ~a dozen.

**Estimated reusable components:** ~**120–160** — a core kit plus signature patterns (StatusPill,
PublishSheet with critical‑ack, HistoryDrawer + DiffView, dual PreviewPane [Guest/AI], BlockEditor,
MediaPicker + UsagePanel, SegmentRuleBuilder + AudiencePreview, RequestTimeline, ConsentCapture,
CommandBar, CapabilityNav, HotelSwitcher, Kpi/meaning cards, TrendChart).

### Top 20 UX principles
1. Whose job does this make easier? — every screen justifies itself by a human.
2. One click less than expected.
3. Everything findable by name (⌘K / search is primary navigation).
4. Preview the truth before it's real (guest *and* AI).
5. Publishing is instant; content is never a deployment.
6. Every important change is reversible; nobody edits in fear.
7. The AI never invents facts; unpublished is unspoken.
8. Show meaning, not just numbers.
9. Calm over dense — one clear action per screen.
10. Role‑aware by design — you only see what you can do.
11. Privacy is sacred — PII and secrets are gated, always.
12. Never expose database concepts or IDs.
13. Human errors, never raw codes.
14. Warm, premium, branded — it must feel worth trusting.
15. Fast where it's noticed; perceived speed is a feature.
16. Empty states teach; the product needs no manual.
17. Notifications enable action, never demand attention for its own sake.
18. Each surface (iPad/laptop/phone) leads with the task it's for.
19. Draft vs Live and Dev vs Prod are always unmistakable.
20. The tool disappears — success is forgetting it's software.

### Top 20 workflow principles
1. Start from the moment (guest arrives, AC breaks), not the module.
2. Bring the context to the user; don't send the user hunting.
3. One thread per real‑world thing (a request lives in one place).
4. Guest‑visible and internal content are always separated.
5. The fastest workflow is the one the AI handles alone.
6. Turn every failure (unanswered question, bad rating) into a fix in one click.
7. Preview is a step, not an afterthought.
8. Critical actions ask exactly once — no more, no less.
9. Inherited vs overridden is always visible.
10. Shared (canonical) vs yours (presentation) is always clear.
11. Consent is captured from published text and never mutated after signing.
12. Sending/secret actions are server‑side and simply not offered to the wrong role.
13. Every workflow ends in a clear, satisfying "done" (with history).
14. Assignment + timeline make responsibility obvious.
15. Search/⌘K can start any workflow from anywhere.
16. Rollback is a normal, safe step — not an emergency.
17. Backlogs (coverage gaps, drafts) are the real onboarding checklist.
18. Real‑time where humans coordinate (reception), quiet elsewhere.
19. No workflow requires leaving AI OLLY for a spreadsheet or WhatsApp.
20. Learn the pattern once, know every workflow.

### Top 20 ways AI OLLY differs from ordinary hotel software
1. It's an operating system for the hotel, not an admin panel.
2. The AI concierge is the product's heart — content exists to make it right.
3. You can *test the AI before guests do* (AI Preview).
4. The AI provably never invents facts; it hands off instead.
5. Guest confusion becomes a ranked content backlog automatically.
6. Draft → Preview → Publish for *hotel content*, like software but instant.
7. Content changes never require a deployment or a developer.
8. Full version history and one‑click rollback on hotel facts.
9. Critical facts (check‑in, safety, price) are protected by design.
10. True multi‑tenant isolation — a hotel never sees another's data.
11. Consent is first‑class, immutable after signing, and enforced in marketing.
12. Marketing *cannot* email a non‑consented list — the shortcut doesn't exist.
13. A real DAM that knows where every asset is used and won't let you break a live page.
14. Analytics that speak meaning ("94% answered"), formula‑versioned and PII‑free.
15. Shared destination content with a per‑hotel presentation layer — no duplication.
16. Reception, content, AI, marketing, and analytics in one calm place — no tool sprawl.
17. Command palette + universal search as primary navigation.
18. An owner experience that's one honest sentence, not a report.
19. Premium consumer‑grade feel (Apple/Linear/Notion/Stripe), not enterprise grey.
20. It's designed to *disappear* — the highest compliment hotel software can earn.

---

*End of UX Bible. No React, Next.js, components, wireframes, Figma, or implementation were created.
This document defines the experience; awaiting review before design/build proceeds.*
