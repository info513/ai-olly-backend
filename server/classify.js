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
export function isContactCoreQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('contact') ||
    q.includes('kontakt') ||
    q.includes('phone') ||
    q.includes('telefon') ||
    q.includes('tel') ||
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
    q.includes('check in') ||
    q.includes('checkin') ||
    q.includes('check out') ||
    q.includes('checkout') ||
    q.includes('arrival time') ||
    q.includes('departure time')
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
