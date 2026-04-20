// server/classify.js — pure functions for language detection and question classification
// Exported so tests can import them directly without starting the server.
// server.js imports these instead of defining them locally.

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ✅ bolja detekcija jezika (HR vs EN)
// Fix #1: "parking" removed — it exists in both HR and EN and caused false HR detection
export function detectLang(question) {
  const q = String(question || '');
  const ql = q.toLowerCase();
  const hasCroChars = /[čćžšđ]/i.test(q);
  const hasHrWords = /\b(je|li|imate|gdje|kada|radno|vrijeme|soba|sobe|doručak|recepcija|adresa|broj|pravila|kućni|molim|hvala|trebam)\b/i.test(ql);
  return (hasCroChars || hasHrWords) ? 'HR' : 'EN';
}

// ✅ kontakt / telefon / email / maps / check-in-out (deterministički)
//
// Fix #4a — /\btel\b/ instead of q.includes('tel'):
//   'tel' is now matched as a whole word only, so 'hotel' and 'obitelj' (HR for
//   family) no longer trigger the hotel-core card.
//
// Fix #4b — 'check in' / 'checkin' now carry experiential-word exclusions:
//   Questions about the CHECK-IN EXPERIENCE ("What is check-in like?",
//   "Kako izgleda check-in?") must NOT be swallowed here; only questions that
//   ask about the check-in/out TIME or schedule should return the core card.
//   Excluded words: experience, izgleda, iskustvo, process, postupak.
//
// Fix #5 — extend the check-in/out guard to also exclude non-timing service
//   requests: early check-in, late check-out, luggage storage, requests about
//   what happens during check-in, etc.  These must route to their dedicated
//   SERVICE records, not the hotel-core card.
//   Added guard: isNonTimingCheckinout — if any of these words are present
//   alongside 'check in' / 'check out', the deterministic gate does NOT fire.
//   Bare "Check-in?" (no additional words) is unaffected and still fires.
export function isContactCoreQuestion(question) {
  const q = normalizeText(question);

  // Check-in/out: only fire for time/schedule queries, not experience queries
  // and not service-request queries (early, late, luggage, during, after, …).
  const hasCheckin  = q.includes('check in')  || q.includes('checkin');
  const hasCheckout = q.includes('check out') || q.includes('checkout');

  // Fix #4b: experiential context — experience/process questions pass through.
  const isExperiential = (
    q.includes('experience') ||
    q.includes('izgleda')    ||
    q.includes('iskustvo')   ||
    q.includes('process')    ||
    q.includes('postupak')
  );

  // Fix #5: non-timing service-request context — early/late/luggage/during/after
  // questions must pass through to their dedicated SERVICE records.
  const isNonTimingCheckinout = (
    q.includes('early')   ||   // "early check-in"
    q.includes('rano')    ||   // HR: "early"
    q.includes('late')    ||   // "late check-out"
    q.includes('kasn')    ||   // HR: "late" — kasni/kasna/kasno/kasnih (all inflections)
    q.includes('luggage') ||   // "luggage after check-out"
    q.includes('prtljag') ||   // HR: "luggage"
    q.includes('baggag')  ||   // "baggage" variant
    q.includes('store')   ||   // "store my luggage"
    q.includes('pohrani') ||   // HR: "store/deposit"
    q.includes('during')  ||   // "during check-in"
    q.includes('after')   ||   // "after check-out"
    q.includes('nakon')   ||   // HR: "after"
    q.includes('possible')||   // "is early check-in possible"
    q.includes('request')      // "request a late check-out"
  );

  // Fix #6: Croatian check-in/out terms — same guards as English equivalents.
  // 'prijava' = check-in; guarded against WiFi-login false positives
  //   ("prijava na Wi-Fi" must not fire hotel_core).
  // 'odjava'  = check-out; less ambiguous, no extra guard needed.
  const hasCroPrijava = (
    q.includes('prijava') &&
    !q.includes('wifi') &&
    !q.includes('wi fi') &&
    !q.includes('internet')
  );
  const hasCroOdjava = q.includes('odjava');

  return (
    q.includes('contact') ||
    q.includes('kontakt') ||
    q.includes('phone') ||
    q.includes('telefon') ||
    /\btel\b/.test(q) ||           // Fix #4a: whole-word only — 'hotel'/'obitelj' no longer match
    q.includes('call') ||
    q.includes('email') ||
    q.includes('e mail') ||
    q.includes('reach') ||
    q.includes('reception') ||
    q.includes('recepc') ||
    q.includes('address') ||
    q.includes('adresa') ||
    q.includes('google maps') ||
    q.includes('maps') ||
    q.includes('instagram') ||
    q.includes('review') ||
    (hasCheckin     && !isExperiential && !isNonTimingCheckinout) ||  // Fix #4b + #5
    (hasCheckout    && !isExperiential && !isNonTimingCheckinout) ||
    (hasCroPrijava  && !isExperiential && !isNonTimingCheckinout) ||  // Fix #6
    (hasCroOdjava   && !isExperiential && !isNonTimingCheckinout) ||  // Fix #6
    q.includes('arrival time') ||
    q.includes('departure time')
  );
}

// ✅ deterministički: pitanja o radnom vremenu doručka
//
// Fix #7 — isBreakfastHoursQuestion:
//   Fires only when the question asks WHEN/WHAT TIME breakfast is served.
//   Must NOT fire on menu, content, or availability questions.
//   Both a breakfast keyword AND a time/schedule signal are required.
export function isBreakfastHoursQuestion(question) {
  const q = normalizeText(question);
  // Note: normalizeText preserves Unicode letters (č, ć, ž, š, đ) — only
  // non-alphanumeric characters are collapsed to spaces.
  // Croatian declension variants:
  //   doručak (nom) / doručka (gen) / doručku (dat) — all start with 'doruč'
  //   Users typing without diacritics produce: dorucak / dorucka → matched by 'doruc'

  const hasBreakfast = (
    q.includes('breakfast') ||
    q.includes('doruč') ||      // HR: diacritic variant (doručak, doručka, doručku…)
    q.includes('doruc')         // HR: no-diacritic variant (dorucak, dorucka…)
  );

  const hasTimeSignal = (
    q.includes('time')       ||
    q.includes('hour')       ||
    q.includes('when')       ||
    q.includes('start')      ||
    q.includes('end')        ||
    q.includes('open')       ||
    q.includes('clos')       ||   // close / closes / closed
    // 'from' intentionally omitted — too broad as standalone preposition;
    // "Can I request X from housekeeping?" would false-fire.
    q.includes('until')      ||
    q.includes('till')       ||
    q.includes('radno')      ||   // HR: "radno vrijeme" (working hours)
    q.includes('kada')       ||   // HR: "when"
    q.includes('koliko')     ||   // HR: "how long / how many"
    q.includes('sati')       ||   // HR: "hours" (plural)
    q.includes('sat ')       ||   // HR: "hour" (singular; space prevents matching "satisfaction")
    q.includes('traje')      ||   // HR: "lasts / runs until"
    q.includes('pocinje')    ||   // HR: "starts" (normalised from počinje)
    q.includes('zavrsava')      // HR: "ends" (normalised from završava)
  );

  return hasBreakfast && hasTimeSignal;
}

// ✅ deterministički: pitanja o radnom vremenu domaćinstva (housekeeping)
//
// Fix #8 — isHousekeepingHoursQuestion:
//   Same two-condition structure as isBreakfastHoursQuestion.
//   Fires only when a housekeeping keyword AND a time/schedule signal are both present.
//   Must NOT fire on service-request questions ("Can housekeeping change my towels?").
//
//   Croatian stem notes (normalizeText preserves diacritics):
//     čišćenj — matches čišćenje (nom) / čišćenja (gen) / čišćenju (dat)
//     ciscenj  — same stems typed without diacritics
//     čistit   — matches čistiti (infinitive) / čistit / čiste / čisti
//     cistit   — same without diacritics
export function isHousekeepingHoursQuestion(question) {
  const q = normalizeText(question);

  const hasHousekeeping = (
    q.includes('housekeeping') ||
    q.includes('sobarica')     ||   // HR: housekeeper / cleaning attendant
    q.includes('čišćenj')      ||   // HR: cleaning noun stem (with diacritic)
    q.includes('ciscenj')      ||   // HR: cleaning noun stem (no diacritic)
    q.includes('čistit')       ||   // HR: to clean — verb stem (with diacritic)
    q.includes('cistit')            // HR: to clean — verb stem (no diacritic)
  );

  const hasTimeSignal = (
    q.includes('time')       ||
    q.includes('hour')       ||
    q.includes('when')       ||
    q.includes('start')      ||
    q.includes('end')        ||
    q.includes('open')       ||
    q.includes('clos')       ||
    // 'from' intentionally omitted — too broad as standalone preposition;
    // "Can I request X from housekeeping?" would false-fire.
    q.includes('until')      ||
    q.includes('till')       ||
    q.includes('radno')      ||
    q.includes('kada')       ||
    q.includes('koliko')     ||
    q.includes('sati')       ||
    q.includes('sat ')       ||
    q.includes('traje')      ||
    q.includes('pocinje')    ||
    q.includes('zavrsava')
  );

  return hasHousekeeping && hasTimeSignal;
}

// ✅ deterministički: WiFi pristup i lozinka
//
// Fix #9 — isWifiQuestion:
//   Any question about WiFi, internet connectivity, the network name, or the
//   password. The Complimentary WiFi record Opis covers all of these in one
//   concise block, so no secondary signal is required.
//
//   'connect' intentionally included — in a hotel widget context this almost
//   always means WiFi connectivity, not room connections or comparisons.
export function isWifiQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('wifi')      ||
    q.includes('wi fi')     ||
    q.includes('password')  ||
    q.includes('lozink')    ||   // HR: lozinka / lozinku / lozinke (password stem)
    q.includes('network')   ||
    q.includes('mrež')      ||   // HR: mreža/mreže/mreži/mrežu (diacritic stem)
    q.includes('mrez')      ||   // HR: mreza/mreze/mrezu (no-diacritic stem)
    q.includes('connect')        // EN: connect / connected / connection
    // 'internet' intentionally omitted — too broad (e.g. "internet corner" amenity)
  );
}

// ✅ deterministički: politika kućnih ljubimaca (pet policy)
//
// Fix #10 — isPetPolicyQuestion:
//   Any question about bringing pets, pet-friendly status, or whether dogs are
//   allowed. No secondary signal required — any pet keyword = policy question.
//
//   'cat' omitted — substring of 'catalog', 'category', etc. → false positives.
//   'pas' omitted — substring of 'pasta', 'pass', 'passenger' → false positives.
//   'ljubim' stem covers all Croatian declension forms of 'ljubimac/ljubimci'.
export function isPetPolicyQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('pet')      ||   // EN: pet / pets / pet-friendly / pet policy
    q.includes('dog')      ||   // EN: dog / dogs
    q.includes('ljubim')        // HR: stem of ljubimac/ljubimci (pet/s)
  );
}

// ✅ deterministički (PWA only): pitanja o klima uređaju / air conditioning
//
// Fix #11a — isAcQuestion:
//   Fires when a guest asks about air conditioning or temperature control.
//   Returns instructions from ROOM GUIDE.Upute Klima.
//
//   'ac' matched with word-boundary regex to prevent false positives with
//   substrings like 'access', 'activate', 'place', 'snack', etc.
//   normalizeText preserves diacritics and lowercases — /\bac\b/ is safe on its output.
export function isAcQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('air con')    ||   // EN: air conditioning / air conditioner / air con
    q.includes('aircon')     ||   // EN: alternative no-space spelling
    /\bac\b/.test(q)         ||   // EN: bare "AC" — word-boundary prevents access/activate/etc.
    q.includes('klima')      ||   // HR: klima / klimatizacija (all inflections)
    q.includes('klimatiz')        // HR: stem of klimatizacija
  );
}

// ✅ deterministički (PWA only): pitanja o TV-u i daljinskom upravljaču
//
// Fix #11b — isTvQuestion:
//   Fires when a guest asks about the TV, remote control, channels, or streaming.
//   Returns instructions from ROOM GUIDE.Upute TV.
//
//   'tv' matched with word-boundary regex to prevent false positives with
//   substrings like 'aktiv', 'gtv', 'btv', etc.
export function isTvQuestion(question) {
  const q = normalizeText(question);
  return (
    /\btv\b/.test(q)           ||   // EN: bare "TV" — word-boundary
    q.includes('television')   ||   // EN: full word
    q.includes('remote')       ||   // EN: remote control
    q.includes('channel')      ||   // EN: TV channels
    q.includes('netflix')      ||   // EN: streaming service
    q.includes('hdmi')         ||   // EN: HDMI input
    q.includes('televizij')         // HR: stem of televizija/televizije/televizijskog
  );
}

// ✅ deterministički (PWA only): pitanja o sefu / pohrani vrijednosti
//
// Fix #11c — isSafeQuestion:
//   Fires when a guest asks about the in-room safe or how to store valuables.
//   Returns instructions from ROOM GUIDE.Upute Sef.
//
//   'lock', 'key', 'box' omitted — too broad (door locks, key policy, lockers).
//   Known tradeoff: "is it safe to walk outside?" also matches 'safe'.
//   Accepted for v1 — in-room PWA context makes this rare; returning
//   safe-box instructions is preferable to hallucination.
export function isSafeQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('safe')        ||   // EN: safe / safe box / safe deposit
    q.includes('sef')         ||   // HR: sef (safe-deposit box)
    q.includes('valuables')        // EN: where to store valuables
  );
}

// ✅ hotel-specific heuristika (da možemo hard-stop kad nema podataka)
export function isHotelSpecificQuestion(question) {
  const q = normalizeText(question);
  const keys = [
    'recepcija','reception','wifi','wi fi','internet','parking','parkiranje','doručak','breakfast',
    'mini bar','minibar','check in','check-out','checkout','checkin','policy','pravila','pet','dog',
    'laundry','dry cleaning','cleaning','housekeeping','room','rooms','soba','sobe','bed','krevet',
    'view','pogled','floor','kat','size','kvadratura','capacity','kapacitet',
    'amenities','oprema','sadržaj',
    'transfer','airport','zračna luka','zracna luka','taxi','uber','directions','how to get','dolazak',
    'invoice','račun','r1','city tax','tourist tax','boravišna','boravisna',
  ];
  return keys.some(k => q.includes(k));
}

export function isCityQuestion(question) {
  const q = normalizeText(question);
  return q.includes('split') || q.includes('dioklecijan') || q.includes('palač') || q.includes('palace') || q.includes('peristil');
}

// ✅ deterministički (PWA only): pitanja o gradskim atrakcijama / razgledavanju / izletima
//
// Fires when a guest asks about sightseeing, local attractions, excursions, or walks.
// Returns a hint pointing to the City Map and Routes sections in the PWA.
// Deliberately narrow — excludes ambiguous terms like "things to do" (could mean hotel
// activities) and bare "nearby" (could mean parking, restaurant, etc.).
export function isCityActivityQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('what to see')     ||  // EN: "what to see nearby"
    q.includes('things to see')   ||  // EN: "things to see in Split"
    q.includes('what to visit')   ||  // EN: "what to visit"
    q.includes('sightseeing')     ||  // EN
    q.includes('attraction')      ||  // EN: attraction/s
    q.includes('landmark')        ||  // EN: landmark/s
    q.includes('excursion')       ||  // EN
    q.includes('znamenit')        ||  // HR: znamenitosti / znamenitost
    q.includes('razgledavanj')    ||  // HR: razgledavanje
    q.includes('atrakcij')        ||  // HR: atrakcije
    q.includes('izlet')           ||  // HR: izlet (excursion/day trip)
    // HR: "što posjetiti / što vidjeti" + location word
    (q.includes('posjetit') && (q.includes('blizin') || q.includes('grad') || q.includes('split'))) ||
    (q.includes('vidjeti')  && (q.includes('blizin') || q.includes('grad') || q.includes('split')))
  );
}

// ✅ deterministički (PWA only): pitanja isključivo o vremenu prijave/odjave
//
// Fires only when the question asks WHEN check-in or check-out is — no other context.
// Returns a concise check-in/out time answer instead of the full hotel card.
// Must fire BEFORE isContactCoreQuestion so the full card is never shown for timing questions.
// Guards mirror isContactCoreQuestion to avoid double-catching non-timing requests.
export function isCheckinTimeOnlyQuestion(question) {
  const q = normalizeText(question);

  const hasCheckinKey = (
    q.includes('check in')  || q.includes('checkin')  ||
    q.includes('check out') || q.includes('checkout') ||
    (q.includes('prijava') && !q.includes('wifi') && !q.includes('wi fi') && !q.includes('internet')) ||
    q.includes('odjava')
  );

  const hasTimeSignal = (
    q.includes('time')     || q.includes('when')     || q.includes('what time') ||
    q.includes('kada')     || q.includes('koliko')   ||
    q.includes('u koliko') || q.includes('sati')     || q.includes('sat ')
  );

  // Non-timing modifiers: early/late requests, luggage, experiential queries, contact/links
  const hasNonTiming = (
    q.includes('early')   || q.includes('rano')     || q.includes('late')    ||
    q.includes('kasn')    || q.includes('luggage')  || q.includes('prtljag') ||
    q.includes('possible')|| q.includes('request')  || q.includes('experience') ||
    q.includes('process') || q.includes('during')   || q.includes('after')   ||
    q.includes('contact') || q.includes('phone')    || q.includes('address') ||
    q.includes('adresa')  || q.includes('telefon')
  );

  return hasCheckinKey && hasTimeSignal && !hasNonTiming;
}
