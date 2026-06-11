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
    q.includes('possible')  ||   // "is early check-in possible"
    q.includes('request')   ||   // "request a late check-out"
    q.includes('procedure') ||   // "checkout procedure" — route to GPT, not hotel card
    q.includes('postupak')  ||   // HR: "procedure" — "postupak prijave/odjave"
    q.includes('how do i')  ||   // Fix #8a: "how do I check out" — procedure question
    q.includes('how to')    ||   // Fix #8a: "how to check out"
    q.includes('what should i') || // "what should I do at check-out" — procedure question
    q.includes('what do i')  ||   // "what do I do with my key at check-out"
    q.includes(' key ')     ||   // bare "key" — "my key at check-out", "return the key"
    q.includes('key card')  ||   // Fix #8a: "return the key card" — checkout detail
    q.includes('key fob')        // Fix #8a: alternative key term
  );

  // Guard: "What are the reception hours?", "Is reception open 24h?", "When does
  // reception close?" — these are schedule/availability questions that should route
  // to the "Reception 24/7" service record via intent matching, NOT dump the full
  // hotel-core card. Both a reception keyword AND a time/hours signal are required.
  const isReceptionHoursQuery = (
    (q.includes('reception') || q.includes('recepc')) &&
    (q.includes('hour')  || q.includes('open')   || q.includes('clos')  ||
     q.includes('sati')  || q.includes('radno')  || q.includes('when')  ||
     q.includes('time')  || q.includes('24')     || q.includes('avail') ||
     q.includes('night') || q.includes('nocu')   || q.includes('schedule'))
  );

  // Fix #8b: local-guide context — questions about nearby places that happen
  // to mention "Google Maps" or "maps" should route to the relevant service
  // record, not the hotel-core card.  The hotel-core card fires on 'maps'
  // to answer "send me the hotel Google Maps link" — but that must not extend
  // to pharmacy/ATM/supermarket/nearest questions.
  const isLocalGuideContext = (
    q.includes('pharmacy')      ||   // "nearest pharmacy — Google Maps link?"
    q.includes('ljekarna')      ||   // HR: pharmacy
    q.includes('atm')           ||   // "nearest ATM"
    q.includes('bankomat')      ||   // HR: ATM
    q.includes('supermarket')   ||   // "nearest supermarket"
    q.includes('nearest')       ||   // "nearest [anything]"
    q.includes('najbliž')       ||   // HR: "nearest"
    q.includes('nearby')        ||   // "nearby options"
    q.includes('near the hotel') ||  // "near the hotel"
    q.includes('blizin')        ||   // HR: "in the vicinity"
    q.includes('restaurant')    ||   // "restaurant with Google Maps"
    q.includes('beach')         ||   // "beach — Google Maps link?"
    q.includes('plaž')               // HR: beach (plaža / plaže…)
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
    (q.includes('reception') && !isReceptionHoursQuery) ||   // guard: reception hours → service record
    (q.includes('recepc')    && !isReceptionHoursQuery) ||
    q.includes('address') ||
    q.includes('adresa') ||
    (q.includes('google maps') && !isLocalGuideContext) ||   // Fix #8b: not for nearby-place questions
    (q.includes('maps') && !isLocalGuideContext) ||           // Fix #8b: same guard
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
//
//   Fix #12 — 'connecting room' exception: "connecting rooms" / "connected rooms"
//   are room-layout questions (family rooms), NOT WiFi questions. Guard them out.
export function isWifiQuestion(question) {
  const q = normalizeText(question);
  // Guard: "connecting rooms", "connected rooms", "connecting room" = room layout, not WiFi.
  const isConnectingRoomQuestion = (
    q.includes('connecting room') ||
    q.includes('connected room')  ||
    q.includes('adjacent room')
  );
  if (isConnectingRoomQuestion) return false;
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
//
//   Safety/maintenance fix: "AC is not working / broken / ne radi" is a
//   maintenance report, NOT a how-to question. These must fall through to GPT
//   which will correctly direct the guest to contact reception.
export function isAcQuestion(question) {
  const q = normalizeText(question);
  // Guard: complaint / breakdown reports — route to GPT → reception handoff.
  const isMaintenanceReport = (
    q.includes('not working')  ||
    q.includes('not work')     ||
    q.includes('broken')       ||
    q.includes('ne radi')      ||   // HR: it's not working
    q.includes('pokvar')       ||   // HR: pokvaren/pokvarena (broken, all inflections)
    q.includes('problem')      ||
    q.includes('issue')        ||
    q.includes('doesnt work')  ||
    q.includes('doesn t work')
  );
  return !isMaintenanceReport && (
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
//
//   Safety/security fix: personal safety questions ("is it safe to walk?",
//   "safe at night") must NOT trigger safe-box instructions. They are guarded
//   via isPersonalSafety and fall through to GPT for a proper answer.
export function isSafeQuestion(question) {
  const q = normalizeText(question);
  // Guard: "is it safe to walk?", "safe at night", "safe around here" etc.
  // are personal-safety questions, not safe-deposit questions.
  const isPersonalSafety = (
    q.includes('safe to')      ||   // "is it safe to walk / swim / go out"
    q.includes('is it safe')   ||   // "is it safe around here"
    q.includes('safe at')      ||   // "safe at night"
    q.includes('safe walk')    ||   // "safe walking"
    q.includes('safe around')  ||   // "safe around the hotel"
    q.includes('safe outside') ||   // "safe outside at night"
    q.includes('safe for')     ||   // "safe for tourists", "safe for families"
    q.includes('is split safe') ||  // "is Split safe"
    q.includes('is the city safe') || // "is the city safe"
    q.includes('city safe')    ||   // "is the old city safe"
    q.includes('town safe')    ||   // "is the old town safe"
    q.includes('area safe')         // "is this area safe"
  );
  return !isPersonalSafety && (
    q.includes('safe')         ||   // EN: safe / safe box / safe deposit
    q.includes('sef')          ||   // HR: sef (safe-deposit box)
    q.includes('valuables')         // EN: where to store valuables
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
    q.includes('walking tour')    ||  // EN: "walking tour", "guided walking tour"
    q.includes('city walk')       ||  // EN: "city walk", "city walking"
    q.includes('guided tour')     ||  // EN: "guided tour"
    q.includes('znamenit')        ||  // HR: znamenitosti / znamenitost
    q.includes('razgledavanj')    ||  // HR: razgledavanje
    q.includes('atrakcij')        ||  // HR: atrakcije
    q.includes('izlet')           ||  // HR: izlet (excursion/day trip)
    // HR: "što posjetiti / što vidjeti" + location word
    (q.includes('posjetit') && (q.includes('blizin') || q.includes('grad') || q.includes('split'))) ||
    (q.includes('vidjeti')  && (q.includes('blizin') || q.includes('grad') || q.includes('split'))) ||
    // Car rental — no service record exists; reception handles all transport recommendations
    q.includes('rent a car')  ||
    q.includes('car rental')  ||
    q.includes('car hire')    ||
    q.includes('hire a car')  ||
    q.includes('rent car')    ||
    q.includes('iznajmiti auto') ||   // HR: rent a car
    q.includes('rent a bike') ||
    q.includes('bike rental') ||
    q.includes('rent a scooter') ||
    q.includes('scooter rental')
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

// ✅ deterministički (PWA only): hitna/medicinska pitanja i pitanja o vatrogasnoj sigurnosti
//
// Fires when a guest signals a potential emergency, medical need, or fire.
// Must fire BEFORE isContactCoreQuestion so medical queries ("I need a doctor,
// who should I call?") never trigger the hotel-card dump with Instagram links.
//
// Returns renderEmergencyAnswer() which includes:
//   — reception phone number (from hotelRec.telefon)
//   — EU emergency number 112
//   — ambulance number 194 (Croatia)
//
// Intentionally broad — false positives (e.g. "fire exit?") are safe because
// returning the reception number + emergency numbers is always a helpful response
// for any fire-related question.
export function isEmergencyQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('emergency')   ||   // EN: emergency / emergency number
    q.includes('hitno')       ||   // HR: urgently / it's urgent
    q.includes('hitna')       ||   // HR: hitna pomoć = ambulance / emergency services
    q.includes('ambulan')     ||   // EN: ambulance
    q.includes('doctor')      ||   // EN: I need a doctor
    q.includes('liječnik')    ||   // HR: doctor (with diacritic)
    q.includes('ljecnik')     ||   // HR: doctor (no diacritic)
    q.includes('hospital')    ||   // EN: hospital
    q.includes('bolnica')     ||   // HR: hospital
    q.includes('fire')        ||   // EN: fire / fire escape / fire alarm / fire exit
    q.includes('požar')       ||   // HR: fire (with diacritic)
    q.includes('pozar')       ||   // HR: fire (no diacritic)
    q.includes('hurt')        ||   // EN: I'm hurt
    q.includes('injured')     ||   // EN: I'm injured
    q.includes('ozlijed')     ||   // HR: injured (stem: ozlijeđen/ozlijeđena)
    q.includes('povrijed')    ||   // HR: hurt (stem: povrijeđen)
    q.includes('pomozite')    ||   // HR: help! (urgent imperative)
    q.includes('upomoć')      ||   // HR: help! (interjection, with diacritic)
    q.includes('upomoc')           // HR: help! (interjection, no diacritic)
  );
}

// ✅ deterministički: pitanja o WhatsApp kontaktu
//
// Fires when a visitor or guest asks whether the hotel has WhatsApp,
// how to contact via WhatsApp, or asks for the WhatsApp number.
// Deliberately narrow — only fires on explicit "whatsapp" mentions.
// Returns a deterministic answer with the WA link, bypassing GPT
// which has no WA data and hallucinated "we don't have WhatsApp".
export function isWhatsAppQuestion(question) {
  const q = normalizeText(question);
  return q.includes('whatsapp') || q.includes('whats app');
}

// ── isParkingAvailabilityQuery ─────────────────────────────────────────────
// Narrow guard for parking-availability questions that GPT tends to
// misclassify as the 'drop off' intent.
//
// Deliberately narrow: only fires on explicit parking-existence phrases.
// Does NOT match:
//   • "drop off" / "drop-off point" — no 'parking' or 'park near' present
//   • "where can I park?" — already handled by Airtable phrase matching
//   • "can I park at the hotel?" — same
//
// Kept as a pre-GPT guard: when it fires, server.js skips chooseIntent()
// and forces the parking_availability_query intent pattern directly.
export function isParkingAvailabilityQuery(question) {
  const q = normalizeText(question);
  return (
    q.includes('is there parking') ||   // "Is there parking near the hotel?"
    q.includes('do you have parking') || // "Do you have parking near the hotel?"
    q.includes('parking near')       || // "Is parking available near …?"
    q.includes('park near')             // "Can I park near the hotel?"
  );
}

// ── isMaintenanceReportQuestion ───────────────────────────────────────────────
// Fires when a guest reports a broken or non-working in-room device/facility.
//
// Pattern: breakdown signal (not working, broken, …) AND device reference.
// Returns a deterministic "contact Reception" answer with the hotel phone
// instead of routing through GPT which has no maintenance data.
//
// Must fire BEFORE chooseIntent() so GPT never handles maintenance reports.
// Safe to be broad — returning the reception phone is always the right answer.
export function isMaintenanceReportQuestion(question) {
  const q = normalizeText(question);

  const hasBreakdown = (
    q.includes('not working')      ||   // EN: "the AC is not working"
    q.includes('not work')         ||   // EN: partial match
    q.includes('doesnt work')      ||   // EN: "it doesn't work"
    q.includes('doesn t work')     ||   // EN: normalised apostrophe
    q.includes('stopped working')  ||   // EN: "it stopped working"
    q.includes('out of order')     ||   // EN: "the shower is out of order"
    q.includes('broken')           ||   // EN: "the door lock is broken"
    q.includes('faulty')           ||   // EN: "faulty socket"
    q.includes('malfunction')      ||   // EN: "malfunction in the bathroom"
    q.includes('ne radi')          ||   // HR: "klima ne radi"
    q.includes('pokvar')           ||   // HR: pokvareno / pokvario (stem)
    q.includes('ne funkcionira')        // HR: "ne funkcionira"
  );

  const hasDevice = (
    q.includes('ac')           ||   // air conditioning shorthand
    q.includes('air con')      ||   // EN: air conditioning
    q.includes('air condition') ||  // EN: air conditioner / air conditioning
    q.includes('klima')        ||   // HR: klima uređaj
    q.includes('heating')      ||   // EN: heating
    q.includes('grijanje')     ||   // HR: heating
    q.includes('hot water')    ||   // EN: "no hot water"
    q.includes('water')        ||   // EN: water (tap, shower, toilet)
    q.includes('voda')         ||   // HR: water
    q.includes('tv')           ||   // EN/HR: TV
    q.includes('television')   ||   // EN: television
    q.includes('toilet')       ||   // EN: toilet
    q.includes('wc')           ||   // EN/HR: WC
    q.includes('shower')       ||   // EN: shower
    q.includes('tuš')          ||   // HR: tuš (shower)
    q.includes('tus')          ||   // HR: normalised
    q.includes('light')        ||   // EN: light
    q.includes('svjetlo')      ||   // HR: light
    q.includes('door')         ||   // EN: door
    q.includes('lock')         ||   // EN: lock
    q.includes('window')       ||   // EN: window
    q.includes('prozor')       ||   // HR: window
    q.includes('socket')       ||   // EN: electric socket
    q.includes('power')        ||   // EN: power
    q.includes('wifi')         ||   // EN: wifi
    q.includes('wi fi')        ||   // EN: wi-fi
    q.includes('drain')        ||   // EN: drain
    q.includes('odtok')        ||   // HR: drain
    q.includes('leak')         ||   // EN: water leak
    q.includes('ceiling')      ||   // EN: ceiling
    q.includes('strop')             // HR: ceiling
  );

  return hasBreakdown && hasDevice;
}

// ── isRoomNumberQuestion ─────────────────────────────────────────────────────
// Fires when a guest asks which room they are in or what their room number is.
// PWA-only handler — room context is only available in pwa-ask, not web-ask.
//
// Guards prevent triggering on questions that mention "room" in a different
// context: service requests, room type/price/view queries, maintenance reports,
// or key/lock questions.  Those must fall through to their own handlers.
//
// Croatian: "broj sobe" = room number; "koja je moja soba" = which is my room.
export function isRoomNumberQuestion(question) {
  const q = normalizeText(question);

  // Guard: "room" in a different context — do NOT intercept these
  if (
    q.includes('room service')    ||  // food/beverage in-room service
    q.includes('room type')       ||  // "what room type am I in"
    q.includes('room price')      ||  // pricing questions
    q.includes('room rate')       ||  // pricing questions
    q.includes('room view')       ||  // view from room
    q.includes('room amenities')  ||  // amenities list
    q.includes('room feature')    ||  // room features
    q.includes('my room key')     ||  // key card
    q.includes('lock my room')       // security
  ) return false;

  return (
    q.includes('my room number')     ||  // "what is my room number?"
    q.includes('room number')        ||  // bare "room number" / "what's the room number"
    q.includes('which room am i')    ||  // "which room am I in?"
    q.includes('what room am i')     ||  // "what room am I in?"
    q.includes('what is my room')    ||  // "what is my room?" (after exclusion guards)
    q.includes('what s my room')     ||  // "what's my room?" (apostrophe → space)
    q.includes('broj sobe')          ||  // HR: "room number"
    q.includes('koja je moja soba')  ||  // HR: "which is my room"
    q.includes('moja soba broj')         // HR: "my room number"
  );
}

// ── isExtraTowelsQuestion ────────────────────────────────────────────────────
// Fires when a guest requests extra towels or asks how to get more.
// PWA-only handler — gives a direct operational answer directing to Reception
// or the Help & Requests section instead of falling to GPT (which safe-handoffs).
//
// Intentionally NOT guarded against housekeeping-hours timing words — the
// housekeeping hours handler requires BOTH a housekeeping keyword AND a time
// signal, so "Can housekeeping bring towels?" (no time signal) falls through to
// this handler correctly.
//
// Croatian: "ručnik/rucnik" = towel; stem covers all inflections.
export function isExtraTowelsQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('towel')   ||  // EN: towel / towels / extra towels
    q.includes('ručnik')  ||  // HR: towel (with diacritic — nominative/accusative)
    q.includes('rucnik')  ||  // HR: towel (no diacritic)
    q.includes('ručnici') ||  // HR: towels plural (with diacritic)
    q.includes('rucnici')     // HR: towels plural (no diacritic)
  );
}

// ── isIdentityQuestion ───────────────────────────────────────────────────────
// Fires when a guest asks about the origin or creator of the AI assistant.
// "Who made you?", "Who created you?", "Who built you?", "What is Dioclea?"
// Returns a deterministic, stable answer that always includes "Antique Split"
// and "assist guests" — required by eval F-005.
//
// Croatian: "tko te je stvorio" = "who created you"; "tko si ti" = "who are you"
export function isIdentityQuestion(question) {
  const q = normalizeText(question);
  return (
    (q.includes('who') && q.includes('made you'))           ||  // "who made you"
    (q.includes('who') && q.includes('created you'))        ||  // "who created you"
    (q.includes('who') && q.includes('built you'))          ||  // "who built you"
    (q.includes('who') && q.includes('behind you'))         ||  // "who is behind you"
    (q.includes('who') && q.includes('made') && q.includes('dioclea')) ||
    q.includes('who are you made by')                       ||  // "who are you made by"
    q.includes('what is dioclea')                           ||  // "what is Dioclea"
    q.includes('who is dioclea')                            ||  // "who is Dioclea"
    (q.includes('tko') && q.includes('stvorio'))            ||  // HR: "tko te je stvorio"
    (q.includes('tko') && q.includes('napravio'))               // HR: "tko te je napravio"
  );
}
