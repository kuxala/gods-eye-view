// Static data for the Iranian missile-range-ring + US-regional-bases layer.
// Source: CSIS Missile Defense Project, "Missiles of Iran"
// https://missilethreat.csis.org/country/iran/ (fetched 2026-09-22, per-missile
// pages spot-checked the same day). Ranges are open-source estimates of
// *maximum* range with nominal payload — not confirmed capability.

/** Note shown on every ring card and in the row legend. */
export const RANGE_NOTE =
  'Approximate maximum range (CSIS open-source estimate). Rings drawn from ' +
  'representative locations, not confirmed launch sites.';

/** Note shown on every base card. */
export const BASE_NOTE =
  'Publicly reported US presence; coordinates approximate. Current force ' +
  'posture not shown.';

/**
 * Missile systems, longest-confirmed-range variant per CSIS's country page.
 * `dashed` distinguishes SRBM (dashed) from MRBM (solid) per the plan's
 * rendering rule.
 * @type {ReadonlyArray<{id: string, name: string, class: string, rangeKm: number, csisUrl: string, confidence: string, color: string, dashed: boolean}>}
 */
export const MISSILE_SYSTEMS = Object.freeze([
  Object.freeze({
    id: 'fateh-110',
    name: 'Fateh-110',
    class: 'SRBM',
    rangeKm: 300,
    csisUrl: 'https://missilethreat.csis.org/missile/fateh-110/',
    confidence:
      'Medium. Variant-dependent (Fateh-313/Zolfaghar are longer-range derivatives).',
    color: '#ffd08a',
    dashed: true,
  }),
  Object.freeze({
    id: 'zolfaghar',
    name: 'Zolfaghar',
    class: 'SRBM',
    rangeKm: 700,
    csisUrl: 'https://missilethreat.csis.org/missile/zolfaghar/',
    confidence: 'Medium',
    color: '#ffb35c',
    dashed: true,
  }),
  Object.freeze({
    id: 'shahab-3',
    name: 'Shahab-3',
    class: 'MRBM',
    rangeKm: 1300,
    csisUrl: 'https://missilethreat.csis.org/missile/shahab-3/',
    confidence:
      'Medium. Older sources give 800-1,000 km for the base variant; CSIS lists 1,300.',
    color: '#ff8a3d',
    dashed: false,
  }),
  Object.freeze({
    id: 'emad',
    name: 'Emad',
    class: 'MRBM',
    rangeKm: 1700,
    csisUrl: 'https://missilethreat.csis.org/missile/emad/',
    confidence: 'Medium',
    color: '#ff5a36',
    dashed: false,
  }),
  Object.freeze({
    id: 'sejjil',
    name: 'Sejjil',
    class: 'MRBM',
    rangeKm: 2000,
    csisUrl: 'https://missilethreat.csis.org/missile/sejjil/',
    confidence: 'Medium-low (limited test history)',
    color: '#ec1313',
    dashed: false,
  }),
  Object.freeze({
    id: 'khorramshahr',
    name: 'Khorramshahr',
    class: 'MRBM',
    rangeKm: 2000,
    csisUrl: 'https://missilethreat.csis.org/missile/khorramshahr/',
    confidence: 'Medium-low. Payload-dependent; Iranian claims vary.',
    color: '#b30f0f',
    dashed: false,
  }),
]);

/**
 * Representative launch cities — NOT verified launch sites. Picked to show
 * the envelope from the west (toward Israel/Iraq), the north-west, and the
 * south (Gulf).
 * @type {ReadonlyArray<{id: string, name: string, at: [number, number]}>}
 */
export const RING_ORIGINS = Object.freeze([
  { id: 'tabriz', name: 'Tabriz (NW Iran)', at: [38.08, 46.292] },
  { id: 'kermanshah', name: 'Kermanshah (W Iran)', at: [34.314, 47.065] },
  { id: 'shiraz', name: 'Shiraz (S-central)', at: [29.592, 52.584] },
  { id: 'bandar-abbas', name: 'Bandar Abbas (Hormuz)', at: [27.183, 56.267] },
]);

/** Default visible origin ids (row chip `ORIGINS: 2/ALL` starts on `2`). */
export const DEFAULT_ORIGIN_IDS = Object.freeze(['kermanshah', 'bandar-abbas']);

/** Default visible missile-system ids (short / medium / max). */
export const DEFAULT_SYSTEM_IDS = Object.freeze([
  'zolfaghar',
  'shahab-3',
  'khorramshahr',
]);

/**
 * Publicly reported US regional bases. Coordinates are approximate
 * airfield/base centroids from public sources (Wikipedia/OSM).
 * @type {ReadonlyArray<{id: string, name: string, country: string, at: [number, number]}>}
 */
export const US_REGIONAL_BASES = Object.freeze([
  {
    id: 'al-udeid',
    name: 'Al Udeid Air Base',
    country: 'Qatar',
    at: [25.117, 51.315],
  },
  {
    id: 'ali-al-salem',
    name: 'Ali Al Salem Air Base',
    country: 'Kuwait',
    at: [29.347, 47.521],
  },
  {
    id: 'camp-arifjan',
    name: 'Camp Arifjan',
    country: 'Kuwait',
    at: [28.88, 48.16],
  },
  {
    id: 'camp-buehring',
    name: 'Camp Buehring',
    country: 'Kuwait',
    at: [29.7, 47.43],
  },
  {
    id: 'nsa-bahrain',
    name: 'NSA Bahrain (US 5th Fleet HQ)',
    country: 'Bahrain',
    at: [26.205, 50.61],
  },
  {
    id: 'al-dhafra',
    name: 'Al Dhafra Air Base',
    country: 'UAE',
    at: [24.248, 54.548],
  },
  {
    id: 'prince-sultan',
    name: 'Prince Sultan Air Base',
    country: 'Saudi Arabia',
    at: [24.063, 47.58],
  },
  {
    id: 'muwaffaq-salti',
    name: 'Muwaffaq Salti Air Base (Azraq)',
    country: 'Jordan',
    at: [31.827, 36.782],
  },
  {
    id: 'ain-al-asad',
    name: 'Al Asad Air Base',
    country: 'Iraq',
    at: [33.786, 42.441],
  },
  {
    id: 'erbil',
    name: 'Erbil Air Base',
    country: 'Iraq',
    at: [36.237, 43.963],
  },
  {
    id: 'al-tanf',
    name: 'Al-Tanf Garrison',
    country: 'Syria',
    at: [33.497, 38.658],
  },
  {
    id: 'incirlik',
    name: 'Incirlik Air Base',
    country: 'Türkiye',
    at: [37.002, 35.426],
  },
  {
    id: 'camp-lemonnier',
    name: 'Camp Lemonnier',
    country: 'Djibouti',
    at: [11.547, 43.155],
  },
  {
    id: 'diego-garcia',
    name: 'NSF Diego Garcia',
    country: 'BIOT',
    at: [-7.313, 72.411],
  },
]);
