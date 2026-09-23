import { createMilitaryBudgetsLayer } from '../../layers/budgets/index.js';
/** Wire the military budget choropleth to the application. */
export function createApplicationMilitaryBudgets() {
  return createMilitaryBudgetsLayer();
}
