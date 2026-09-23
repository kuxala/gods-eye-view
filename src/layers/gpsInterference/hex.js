/**
 * Pure axial-hex math for the GPS-interference grid (T7). Pointy-top hexes
 * on a plain equirectangular lon/lat plane — no H3 dependency, not
 * equal-area (acceptable at the 12-40N theatre latitudes this grid covers).
 * Shared between the server poller (server/providers/aircraft/gps-interference.js,
 * which imports this module via a relative path — see firms.js's import of
 * src/data/firmsCsv.js for the established pattern) and the client layer.
 */

const SQRT3 = Math.sqrt(3);

/** Axial (q, r) hex center, in [lon, lat] degrees. */
export function hexCenter(q, r, sizeDeg) {
  const lon = sizeDeg * (SQRT3 * q + (SQRT3 / 2) * r);
  const lat = sizeDeg * 1.5 * r;
  return [lon, lat];
}

/** The 6 vertices of a pointy-top hex at axial (q, r), each [lon, lat]. */
export function hexVertices(q, r, sizeDeg) {
  const [cx, cy] = hexCenter(q, r, sizeDeg);
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    vertices.push([
      cx + sizeDeg * Math.cos(angle),
      cy + sizeDeg * Math.sin(angle),
    ]);
  }
  return vertices;
}

/** Round fractional cube coordinates to the nearest integer hex. */
function cubeRound(qf, rf) {
  const x = qf;
  const z = rf;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/** Which axial hex (q, r) a [lat, lon] point falls in, inverting hexCenter. */
export function pointToCell(lat, lon, sizeDeg) {
  const qf = ((SQRT3 / 3) * lon - lat / 3) / sizeDeg;
  const rf = ((2 / 3) * lat) / sizeDeg;
  return cubeRound(qf, rf);
}

/** Stable string key for an axial hex, for use as a Map key. */
export function cellKey(q, r) {
  return `${q}_${r}`;
}

/** Inverse of cellKey. */
export function parseCellKey(key) {
  const [q, r] = key.split('_').map(Number);
  return { q, r };
}
