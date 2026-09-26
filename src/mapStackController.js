import { MapSourceController } from './maps/controller.js';
import { createDefaultMapSources } from './maps/defaultSources.js';
import { governorRequestRender } from './renderGovernor.js';
export { MAP_STACKS } from './maps/catalog.js';
export { photorealUnavailableReason } from './maps/availability.js';

/** Preserve the standalone entry point; applications can compose the source controller directly. */
export class MapStackController extends MapSourceController {
  constructor(viewer, options = {}) {
    const googleApiKey =
      typeof window !== 'undefined' ? window.__GOOGLE_MAPS_API_KEY__ : '';
    const registry = createDefaultMapSources({ ...options, googleApiKey });
    super(viewer, {
      registry,
      initialStack: options.googleTileset
        ? options.initialStack || 'photoreal'
        : registry.defaultId,
      ...options,
      requestRender: governorRequestRender,
    });
    this.googleTileset = options.googleTileset || null;
    this.cesiumToken = String(options.cesiumToken || '').trim();
    this._photorealDeferred = Boolean(options.photorealDeferred);
    this._onPhotorealChoice = options.onPhotorealChoice || null;
  }
  /** A deferred photoreal stack stays pickable from the chips (it opts in). */
  getStacks() {
    return super
      .getStacks()
      .map((stack) =>
        stack.id === 'photoreal' && this._photorealDeferred
          ? { ...stack, available: true, unavailableReason: null }
          : stack,
      );
  }
  /**
   * Operator chip pick. Picking Google 3D while it is deferred records the
   * opt-in (the owner reboots to load the tileset); picking any other map
   * records the opt-out (also when a failed tileset fell back to Esri).
   * @param {string} id
   * @returns {boolean} true when the pick was consumed (no stack switch).
   */
  handleUserSelect(id) {
    if (id === 'photoreal' && this._photorealDeferred) {
      this._onPhotorealChoice?.(true);
      return true;
    }
    if (id !== 'photoreal') this._onPhotorealChoice?.(false);
    return false;
  }
  _hasPhotorealCredentials() {
    const googleKey =
      typeof window !== 'undefined' ? window.__GOOGLE_MAPS_API_KEY__ : '';
    return (
      Boolean(String(googleKey || '').trim()) ||
      Boolean(String(this.cesiumToken || '').trim())
    );
  }
}
