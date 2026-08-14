// media-split.js — Split location & module photography for the guest PWA.
// -----------------------------------------------------------------------------
// Real photos for Split POIs and service categories, served from the AI OLLY
// public media CDN (Supabase Storage `public-media`, public-read). The PWA reads
// POI/module DATA from the Airtable backend as before; this file only supplies
// the imagery layer, matched to each POI by name. No secrets, browser-served.
//
// Matching is diacritic- and punctuation-insensitive, and ignores any text in
// parentheses, so Airtable "POI Naziv" values map reliably (e.g. "The Riva
// (Waterfront)" → riva). Unmatched POIs keep their existing category gradient.

(function () {
  var CDN = 'https://mcgrccvvybgcozeqlisj.supabase.co/storage/v1/object/public/public-media/';
  var D = CDN + 'destinations/2cd0ab85-b9a7-4fd1-875c-94d57fe2ab5e/';
  var H = CDN + 'hotels/4a8e6860-068f-4412-b226-18942f63223c/';

  // Exact Airtable "POI Naziv" → photo URL (only POIs we have real photos for).
  var POI_BY_NAME = {
    'The Substructures':               D + 'poi/e893c875-8a29-4191-94fc-1bc1883805a1/podrumi.jpg',
    'Peristyle (Peristil)':            D + 'poi/a3838ff8-f4a3-42ae-bb5a-aca86aa41df4/peristil.jpg',
    'The Golden Gate':                 D + 'poi/24d63684-8d0b-46ef-b86e-74ca8d5b6c2e/zlatna_vrata.jpg',
    'The Silver Gate':                 D + 'poi/46a93515-e381-428e-9bec-a87cabfb3a3b/srebrena_vrata.jpg',
    'Prokurative (Republic Square)':   D + 'poi/1a51154d-f6b7-4772-9b8c-c3eec7b68300/prokurative.jpg',
    'Cathedral of Saint Domnius':      D + 'poi/0e951175-01a6-4f2e-976e-da454113d39e/sv_duje.jpg',
    'Matejuška Port':                  D + 'poi/00021280-6855-415e-9d48-9e057affc349/matejuska.jpg',
    "Pjaca (People’s Square)":    D + 'poi/07c5f24b-2d34-4037-b480-917989f1a11b/pjaca.jpg',
    'Sustipan Park':                   D + 'poi/97426eee-11c8-4ee9-ae49-042b527bae06/sustipan.jpg',
    'Voćni trg (Fruit Square)':        D + 'poi/06fa53f7-6c58-4fd8-99a5-811470fc01d1/trg_brace_radic.jpg',
    'The Fish Market':                 D + 'poi/0ac7b1b4-32e6-4bef-8e63-d81ad993e9b4/ribarnica.jpg',
    'Temple of Jupiter (Baptistery)':  D + 'poi/4b181def-d5f5-4c8a-b5d3-a9869955feb0/krstionica.jpg',
    'The Riva (Waterfront)':           D + 'poi/b0b91822-0bca-4f39-a532-41108ae2717c/riva.jpg',
    'Marmont Street':                  D + 'poi/22d3d66a-eea0-42fe-a4ff-4dbdd213635d/marmontova.jpg',
    "Strossmayer’s Park (Đardin)": D + 'poi/5150d31e-a6e4-4d9d-ac58-ff4aa750fa04/djardin.jpg',
    'Pazar (Green Market)':            D + 'poi/2c644354-2df0-4c69-a61f-c24ba13c41ee/pazar.jpg',
    'Vestibule':                       D + 'poi/f90e733d-792b-4dab-aef8-6ffcba3db67a/vestibul.jpg',
    // POIs not yet in the Airtable list, ready if added later:
    'Grgur Ninski (Gregory of Nin)':   D + 'poi/6ca80c0a-0b5e-495e-bb57-75994babc518/Grgur-Ninski.jpg',
    'Church of St Francis (Sv. Frane)': D + 'poi/cf4a1050-129d-4636-8678-109ab5a22723/sv_frane.jpg',
    'Palace Walls (Zidine palače)':    D + 'poi/574a7625-759f-4984-b8c3-9749b8110b33/zidine.jpg',
    "Streets of Diocletian’s Palace (Ulice)": D + 'poi/438cfc3f-cd75-4f8b-bd16-ec2642938e10/ulice.jpg',
  };

  // "Near Me" category id (openNearMeCategory('...')) → photo URL.
  var NEAR_ME = {
    pharmacy:    D + 'module/4549c871-e548-4755-8c7d-cafe6c126431/pharmacy.jpg',
    atm:         D + 'module/3fab6813-5007-486c-aef8-7a1452cdc12a/atm.jpg',
    supermarket: D + 'module/396c2997-ee46-40b3-a1eb-4e0e8cfbd2c4/supermarket.jpg',
    transport:   D + 'module/3789a0cb-7f43-42f2-9c28-ed44038eb5ce/ferry_bus.jpg',
    landmarks:   D + 'poi/a3838ff8-f4a3-42ae-bb5a-aca86aa41df4/peristil.jpg',
  };

  // Home module tile (openModule('...')) → photo URL.
  var MODULE = {
    'room-guide': H + 'module/0d622812-15bf-4829-bb8f-26b796ee5968/room_guide.jpg',
    'services':   H + 'module/27da456e-9499-4ff2-a62c-f0b65d93bb45/hotel_services.jpg',
    'concierge':  H + 'module/b38e61e5-cfb7-4c29-be16-5472f1c7e00c/concierge.jpg',
    'help':       H + 'module/d776be19-3aaf-498e-844e-60d37ebe97ea/help-request.jpg',
    'near-me':    D + 'module/8a080629-03e7-45ca-905d-79c0776922dd/gastro.jpg',
  };

  // Normalize a name for tolerant matching: strip parentheticals, diacritics,
  // and non-alphanumerics; lowercase.
  function norm(s) {
    return String(s || '')
      .replace(/\([^)]*\)/g, ' ')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  var POI_INDEX = {};
  Object.keys(POI_BY_NAME).forEach(function (k) { POI_INDEX[norm(k)] = POI_BY_NAME[k]; });

  window.SPLIT_MEDIA = {
    poiImage: function (name) {
      if (!name) return null;
      return POI_BY_NAME[name] || POI_INDEX[norm(name)] || null;
    },
    nearMeImage:  function (id) { return NEAR_ME[id] || null; },
    moduleImage:  function (id) { return MODULE[id] || null; },
  };
})();
