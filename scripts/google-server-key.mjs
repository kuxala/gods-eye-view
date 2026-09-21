/**
 * Server credentials for Google Places / Street View. MilitarySpend fork: no
 * fallback to GOOGLE_MAPS_API_KEY — that key is scoped to Map Tiles only, and
 * Places is $32 per 1,000 calls. Server-side Google features stay off unless
 * a separately-scoped server key is set on purpose.
 */
export function resolveGoogleServerKey(environment = {}, defaults = {}) {
  const value = (name) => String(environment[name] ?? defaults[name] ?? '').trim();
  return value('GOOGLE_MAPS_SERVER_API_KEY');
}
