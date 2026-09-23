import { createStrikeCandidatesLayer } from '../../layers/strikeCandidates/index.js';

/** Bind the shared FIRMS feed to the strike-candidates application layer. */
export function createApplicationStrikeCandidates({ feed }) {
  return createStrikeCandidatesLayer({ feed });
}
