// config.js — per-hotel static configuration
// Change this file when deploying for a different hotel.
// Do not put secrets here — this file is served to browsers.

const CONFIG = {
  hotelName:   'Hotel Antique Split',
  phone:       '+38521785208',
  whatsapp:    '38521785208',   // digits only, no +
  reception:   'Reception is available 24 hours a day.',
  address:     'Ul. Dioklecijanova 1, 21000 Split, Croatia',
  checkIn:     'From 14:00',
  checkOut:    'Until 11:00',
  hotelCoords: { lat: 43.5088, lng: 16.4401 },
  apiBase:     '',              // empty = same origin; set to full URL in production
};
