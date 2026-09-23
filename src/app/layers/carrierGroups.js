import { createCarrierGroupsLayer } from '../../layers/carrierGroups/index.js';

/** Construct the placeholder carrier strike group layer. No catalog source:
 * it fetches public/ms/carrier-groups.json directly via an injectable fetchImpl. */
export function createApplicationCarrierGroups({ fetchImpl } = {}) {
  return createCarrierGroupsLayer({ fetchImpl });
}
