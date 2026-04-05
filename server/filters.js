// server/filters.js — pure filter functions for hotel slug and AI_SOURCE filtering
// Exported so tests can import directly without starting the server.
// server.js imports these instead of defining them locally.

export function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

export function isEmptyArray(v) {
  return Array.isArray(v) && v.length === 0;
}

export function fieldHasAny(fieldsValue, allowed) {
  const arr = asArray(fieldsValue).map(String);
  const allowedSet = new Set(allowed.map(String));
  return arr.some(v => allowedSet.has(v));
}

export function valuesToStrings(v) {
  return asArray(v).map(x => String(x).trim()).filter(Boolean);
}

export function matchesHotelSlug(fieldValue, hotelSlug) {
  const target = String(hotelSlug || '').trim();
  const vals = valuesToStrings(fieldValue);
  return vals.some(x => x === target);
}

// WEB filter: zahtijeva eksplicitno WEB ili BOTH — fail-closed, prazno ne prolazi
export function allowForWeb(aiSourceArr) {
  const src = asArray(aiSourceArr);
  return fieldHasAny(src, ['WEB', 'BOTH']);
}

// PWA filter: zahtijeva eksplicitno PWA ili BOTH — fail-closed, prazno ne prolazi
export function allowForPWA(aiSourceArr) {
  const src = asArray(aiSourceArr);
  return fieldHasAny(src, ['PWA', 'BOTH']);
}

// Linked record filter — kombinacija sva tri uvjeta (fail-closed)
export function passesLinkedFilter(r, hotelSlug) {
  return (
    r.active === true &&
    allowForWeb(r.aiSource) &&
    matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
  );
}
