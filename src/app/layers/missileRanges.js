import { createMissileRangesLayer } from '../../layers/missileRanges/index.js';

/** Wire the static Iranian missile-range-ring + US-regional-bases layer to the application. */
export function createApplicationMissileRanges() {
  return createMissileRangesLayer();
}
