/**
 * Axis-aligned regional boxes for the FIRMS strike-candidate layer. A
 * detection keeps the id of the FIRST box (declaration order) that contains
 * it — overlaps between boxes are fine, first match wins.
 *
 * box: [south, west, north, east] in degrees.
 */
export const STRIKE_WATCH_BOXES = Object.freeze([
  { id: 'iran', label: 'Iran', box: [25.0, 44.0, 39.8, 63.4] },
  { id: 'iraq', label: 'Iraq', box: [29.0, 38.8, 37.4, 48.6] },
  // Kuwait, E. Saudi, Bahrain, Qatar, UAE
  { id: 'gulf', label: 'Gulf states', box: [22.5, 47.0, 30.2, 56.5] },
  {
    id: 'hormuz-oman',
    label: 'Hormuz / Gulf of Oman',
    box: [22.5, 56.0, 27.2, 61.8],
  },
  {
    id: 'israel-leb',
    label: 'Israel / Lebanon',
    box: [29.4, 34.2, 34.7, 36.7],
  },
  {
    id: 'yemen',
    label: 'Yemen / Bab el-Mandeb',
    box: [12.0, 42.5, 19.0, 54.0],
  },
]);

/**
 * Find the first region box (declaration order) containing a point.
 * @param {number} lat
 * @param {number} lon
 * @returns {?{id: string, label: string, box: Array<number>}} The matching region, or null.
 */
export function regionFor(lat, lon) {
  for (const region of STRIKE_WATCH_BOXES) {
    const [south, west, north, east] = region.box;
    if (lat >= south && lat <= north && lon >= west && lon <= east)
      return region;
  }
  return null;
}
