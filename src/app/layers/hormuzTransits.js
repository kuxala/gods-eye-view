import { createHormuzTransitsLayer } from '../../layers/hormuzTransits/index.js';

/** Construct the Hormuz transit counter layer. No catalog source: it fetches
 * /api/ais-live/hormuz directly via an injectable fetchImpl. */
export function createApplicationHormuzTransits({ fetchImpl } = {}) {
  return createHormuzTransitsLayer({ fetchImpl });
}
