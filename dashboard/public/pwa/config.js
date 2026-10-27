// config.js — per-hotel static configuration
// Change this file when deploying for a different hotel.
// Do not put secrets here — this file is served to browsers.

const CONFIG = {
  hotelName:   'Hotel Antique Split',
  phone:       '+38521785208',
  mobile:      '+385915256985',
  whatsapp:    '385915256985',  // digits only, no + (official reception mobile)
  reception:   'Reception is available 24 hours a day.',
  address:     'Poljana Grgura Ninskog 1, 21000 Split, Croatia',
  checkIn:     'From 14:00',
  checkOut:    'Until 11:00',
  hotelCoords: { lat: 43.5088, lng: 16.4401 },
  apiBase:     '',              // empty = same origin; set to full URL in production
};
