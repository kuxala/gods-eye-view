import {
  createIranWarEventsLayer,
  createIranWarTimelineSource,
} from '../../layers/warEvents/index.js';

/** Wire the Iran-war event map + date scrubber to the application. */
export function createApplicationIranWarEvents() {
  return createIranWarEventsLayer({ source: createIranWarTimelineSource() });
}
