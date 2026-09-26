import { createApplicationOperations } from './operations.js';
import * as Cesium from 'cesium';
import {
  applyViewerQuality,
  createApplicationViewer,
  installTrackpadPinchZoom,
} from '../app/viewer.js';
import {
  getQualityPreset,
  isPhotorealOptedIn,
  onQualityTierChange,
  setPhotorealOptIn,
} from '../qualityTier.js';
import { registerDataCredits } from '../data/dataCredits.js';
import { configureCreditKeyboardAccess } from '../creditKeyboard.js';
import { MapStackController } from '../mapStackController.js';
import { loadPhotorealisticTileset } from '../mapStartup.js';
import { initLogoGaze } from '../logoGaze.js';
import {
  uninstallRenderGovernor,
  governorRequestRender,
} from '../renderGovernor.js';
import { describeError } from './errors.js';

/** Construct the application globe using the caller's local configuration. */
export async function createApplicationScene({
  requestServices,
  googleApiKey,
  cesiumToken,
  credits,
  MapController = MapStackController,
  mapOptions = {},
  loaderStatus,
  signal,
  defer,
}) {
  const operations = createApplicationOperations({
    requests: requestServices,
    signal,
  });
  defer(initLogoGaze());
  const previousKey = window.__GOOGLE_MAPS_API_KEY__;
  if (googleApiKey) {
    window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
    defer(() => {
      if (window.__GOOGLE_MAPS_API_KEY__ !== googleApiKey) return;
      if (previousKey === undefined) delete window.__GOOGLE_MAPS_API_KEY__;
      else window.__GOOGLE_MAPS_API_KEY__ = previousKey;
    });
  }
  loaderStatus.textContent = 'Configuring viewer...';
  // Provider attribution stays visible, including clean-view and recording.
  const creditContainer = document.createElement('div');
  creditContainer.id = 'cesium-credits';
  document.body.appendChild(creditContainer);
  defer(() => creditContainer.remove());
  const viewer = createApplicationViewer({
    container: 'cesiumContainer',
    creditContainer,
  });
  defer(() => {
    uninstallRenderGovernor(viewer);
    if (!viewer.isDestroyed()) viewer.destroy();
  });
  defer(installTrackpadPinchZoom(viewer));
  registerDataCredits(viewer, credits);
  configureCreditKeyboardAccess(document);
  const hasPhotorealCredentials = Boolean(googleApiKey || cesiumToken);
  // No Google photoreal tileset unless the operator opted in (map chip) and
  // the tier allows it — the keyless ellipsoid + Esri imagery is the default.
  const qualityPreset = getQualityPreset();
  const photorealSkipped =
    hasPhotorealCredentials &&
    !(qualityPreset.photoreal && isPhotorealOptedIn());
  loaderStatus.textContent =
    hasPhotorealCredentials && !photorealSkipped
      ? 'Loading Google 3D Tiles...'
      : 'Loading the keyless globe...';
  const photoreal = photorealSkipped
    ? { tileset: null, route: 'osm', errors: [] }
    : await loadPhotorealisticTileset(Cesium, {
        googleApiKey,
        cesiumToken,
        budget: qualityPreset.tileset,
      });
  const tileset = photoreal.tileset;
  // A provider can finish after cancellation; retain ownership of its result.
  defer(() => {
    if (tileset && !tileset.isDestroyed()) {
      if (!viewer.scene.primitives.remove(tileset)) tileset.destroy();
    }
  });
  signal.throwIfAborted();
  if (tileset) {
    viewer.scene.primitives.add(tileset);
    // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
    // Google Photorealistic 3D Tiles provide their own terrain/elevation.
    viewer.scene.globe.show = false;
    console.info(`[Init] Google 3D Tiles loaded via ${photoreal.route}.`);
  } else {
    if (photoreal.errors.length) {
      const tileError = photoreal.errors.at(-1);
      console.warn(
        '[Init] Google 3D Tiles unavailable, using the keyless globe:',
        tileError,
      );
      const tileErrorDetail = describeError(tileError);
      loaderStatus.textContent = `Google 3D Tiles unavailable (${tileErrorDetail}). Loading the keyless globe...`;
    }
    viewer.scene.globe.show = true;
  }

  loaderStatus.textContent = 'Initializing systems...';

  const mapStackController = new MapController(viewer, {
    requestRender: governorRequestRender,
    ...mapOptions,
    googleTileset: tileset,
    cesiumToken,
    photorealDeferred: photorealSkipped && qualityPreset.photoreal,
    onPhotorealChoice: (optedIn) => {
      setPhotorealOptIn(optedIn);
      // Loading the tileset cleanly needs a boot; opting out just forgets it.
      if (optedIn) window.location.reload();
    },
    initialStack: tileset ? 'photoreal' : 'esri-imagery',
    // Task 5 (height-datum fix): rebroadcast stack changes as a window
    // CustomEvent so data layers (CCTV per-regime ground resolution) can
    // react without coupling MapStackController to layer modules. Fires on
    // 'switching'/'ready'/'error'; listeners derive the surface regime from
    // live scene state, so intermediate emissions are harmless.
    onChange: (state) => {
      window.dispatchEvent(
        new CustomEvent('gev:map-stack-changed', { detail: state }),
      );
    },
    onError: (message) => console.warn('[MapStack]', message),
  });
  defer(() => mapStackController.destroy());
  await mapStackController.setStack(tileset ? 'photoreal' : 'esri-imagery', {
    silent: true,
  });

  signal.throwIfAborted();

  // Live tier changes (DISPLAY ▸ Quality or the runtime watchdog).
  let tierHidPhotoreal = false;
  defer(
    onQualityTierChange(({ reason }) => {
      const preset = getQualityPreset();
      applyViewerQuality(viewer, preset, tileset);
      const activeId = mapStackController.getActiveId();
      if (!preset.photoreal && activeId === 'photoreal') {
        tierHidPhotoreal = true;
        void mapStackController.setStack('esri-imagery');
      } else if (preset.photoreal && tierHidPhotoreal) {
        tierHidPhotoreal = false;
        if (activeId === 'esri-imagery')
          void mapStackController.setStack('photoreal');
      } else if (
        preset.photoreal &&
        photorealSkipped &&
        isPhotorealOptedIn() &&
        reason === 'override'
      ) {
        // Booted on low without the tileset; loading it cleanly needs a boot.
        window.location.reload();
        return;
      }
      governorRequestRender('quality-tier');
    }),
  );
  return { viewer, tileset, mapStackController, operations };
}
