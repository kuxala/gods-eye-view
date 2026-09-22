import { QUALITY_PRESETS } from '../qualityTier.js';

const clean = (value) => String(value || '').trim();
/** Tile budget from the active quality tier (high when unspecified). */
const DEFAULT_TILE_BUDGET = QUALITY_PRESETS.high.tileset;

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({
  googleApiKey = '',
  cesiumToken = '',
} = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '', budget = DEFAULT_TILE_BUDGET } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    try {
      const tileset = attempt.googleKey
        ? await createGoogleDirectTileset(Cesium, attempt.googleKey, budget)
        : await createGoogleIonTileset(Cesium, ionToken, { budget });
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return { tileset: null, route: 'osm', errors };
}

/** Pass credentials to the source instead of changing SDK-wide defaults. */
export function createGoogleDirectTileset(
  Cesium,
  key,
  budget = DEFAULT_TILE_BUDGET,
) {
  key = clean(key);
  if (!key) throw new Error('Google 3D requires an explicit browser key');
  return Cesium.createGooglePhotorealistic3DTileset(
    {
      key,
      onlyUsingWithGoogleGeocoder: true,
    },
    {
      cacheBytes: budget.cacheBytes,
      maximumCacheOverflowBytes: 256 * 1024 * 1024,
      maximumScreenSpaceError: budget.maximumScreenSpaceError,
      dynamicScreenSpaceError: true,
      preloadWhenHidden: false,
      preloadFlightDestinations: false,
    },
  );
}

export async function createGoogleIonTileset(
  Cesium,
  accessToken,
  { signal, budget = DEFAULT_TILE_BUDGET } = {},
) {
  accessToken = clean(accessToken);
  if (!accessToken)
    throw new Error('Google 3D through ion requires an explicit token');
  signal?.throwIfAborted();
  const resource = await Cesium.IonResource.fromAssetId(2275207, {
    accessToken,
  });
  signal?.throwIfAborted();
  // Match the direct helper's embed-friendly rendering/cache budget.
  return Cesium.Cesium3DTileset.fromUrl(resource, {
    cacheBytes: budget.cacheBytes,
    maximumCacheOverflowBytes: 256 * 1024 * 1024,
    enableCollision: true,
    maximumScreenSpaceError: budget.maximumScreenSpaceError,
    dynamicScreenSpaceError: true,
    preloadWhenHidden: false,
    preloadFlightDestinations: false,
  });
}
