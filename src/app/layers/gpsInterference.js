import { createGpsInterferenceLayer } from '../../layers/gpsInterference/index.js';

/** Construct the GPS-interference hex-grid layer. No catalog source: it
 * fetches /api/gps-interference directly via an injectable fetchImpl,
 * mirroring hormuzTransits.js. */
export function createApplicationGpsInterference({ fetchImpl } = {}) {
  return createGpsInterferenceLayer({ fetchImpl });
}
