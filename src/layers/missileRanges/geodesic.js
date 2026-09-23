import * as Cesium from 'cesium';

/** Mean earth radius (m), spherical approximation — matches the plan's formula. */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Spherical destination point: given an origin, a bearing and a distance,
 * return the resulting [lat, lon] in degrees.
 * @param {number} latDeg Origin latitude.
 * @param {number} lonDeg Origin longitude.
 * @param {number} bearingDeg Bearing, degrees clockwise from north.
 * @param {number} distanceM Great-circle distance, meters.
 * @returns {[number, number]} [lat, lon] degrees.
 */
function destinationPoint(latDeg, lonDeg, bearingDeg, distanceM) {
  const phi1 = latDeg * RAD;
  const lambda1 = lonDeg * RAD;
  const theta = bearingDeg * RAD;
  const delta = distanceM / EARTH_RADIUS_M;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return [phi2 * DEG, ((lambda2 * DEG + 540) % 360) - 180];
}

/**
 * Build a closed geodesic ring (great-circle "circle") around an origin.
 * Used instead of `Cesium.EllipseGraphics`, which is a tangent-plane
 * ellipse and distorts badly at 1,000-2,000 km radii.
 * @param {{lat: number, lon: number, radiusKm: number, pointCount?: number}} options
 * @returns {{ positions: Cesium.Cartesian3[], southernmost: [number, number] }}
 *   `positions` is a closed ring (first point repeated at the end);
 *   `southernmost` is the [lat, lon] of the ring's lowest-latitude point,
 *   for label placement.
 */
export function buildGeodesicRing({ lat, lon, radiusKm, pointCount = 180 }) {
  const radiusM = radiusKm * 1000;
  const positions = [];
  let southernmost = null;
  for (let i = 0; i <= pointCount; i++) {
    const bearing = (360 * i) / pointCount;
    const [ptLat, ptLon] = destinationPoint(lat, lon, bearing, radiusM);
    positions.push(Cesium.Cartesian3.fromDegrees(ptLon, ptLat));
    if (!southernmost || ptLat < southernmost[0]) southernmost = [ptLat, ptLon];
  }
  return { positions, southernmost };
}
