/**
 * Idle render governor — the wave-2 flagship of the 2026-08-05 perf
 * investigation.
 *
 * The problem: Cesium's default render loop repaints every vsync forever, so
 * the app burned ~60% GPU + ~54% of a core with ZERO layers enabled and a
 * parked camera. The fix: flip the scene into Cesium's `requestRenderMode`
 * whenever nothing animates per frame, and return to the continuous loop the
 * moment something does.
 *
 * Architecture — a binary mode driven by ref-counted holds:
 *
 * - **Continuous mode** (`requestRenderMode = false`, today's behavior)
 *   while ANY hold is registered. Every per-frame animator — fleet
 *   interpolation, traffic sim, satellite motion, tracked-entity follow,
 *   style crossfades, CCTV projection — registers a hold for exactly the
 *   lifetime of its scene-loop listener or animation. While one is active,
 *   behavior is byte-identical to pre-governor main: the locked
 *   interpolation/tracking invariants are preserved by construction.
 * - **Idle mode** (`requestRenderMode = true`) when zero holds. Cesium
 *   auto-renders on camera input and tile loads; every other scene mutation
 *   must call `governorRequestRender()` for its one frame. Discrete
 *   mutators (layer poll ticks, slider writes, annotation changes) route
 *   through that.
 *
 * Holds are identity-keyed (a Set of owner ids), NOT a counter — a module
 * that double-holds or double-releases cannot corrupt the mode. Owners are
 * short stable strings ('flights', 'traffic', 'style-anim', …) so the
 * diagnostics read like a story.
 *
 * The governor is O(1) passive: no per-frame work of its own, ever.
 *
 * Frame-rate budget: 30 fps while the camera moves or a camera-driven hold is
 * active; 15 fps when the camera is parked and only data layers animate.
 *
 * Ticked data mode (2026-09-22): when the camera is parked, ≥ 20 km up, and
 * every hold is a tickable data animator, the scene stays in
 * `requestRenderMode` and ONE governor-owned interval requests a frame at an
 * altitude-based cadence (1 Hz above 2,000 km, 2 Hz above 200 km, 5 Hz
 * above 20 km). The animators' preRender passes dead-reckon from the wall
 * clock, so each ticked frame draws current positions — dots step, never
 * rewind. Camera motion or any non-data hold returns to continuous.
 */

import { getQualityPreset, onQualityTierChange } from './qualityTier.js';

let _viewer = null;
let _installed = false;
const _holds = new Set();
let _cameraMoving = false;
let _removeCameraListeners = null;
let _removeQualityListener = null;

const MOVING_FRAME_RATE = 30;
const PARKED_FRAME_RATE = 15;
/** Holds whose per-frame work moves the camera — these always get 30 fps. */
const CAMERA_DRIVEN_HOLDS = new Set([
  'camera-verb',
  'camera-orbit',
  'cockpit',
  'tracked-entity',
  'cctv-adjust',
  'cctv-projection',
]);

/**
 * Holds whose per-frame work is a wall-clock data animator (preRender dead
 * reckoning / propagation), safe to advance on discrete ticks.
 */
const TICKED_DATA_HOLDS = new Set([
  'flights',
  'ais-vessels',
  'military',
  'satellites',
  'rocket-launches',
  'military-awareness',
]);
let _dataTickTimer = null;
let _dataTickIntervalMs = 0;

/** Ticked-mode interval for a parked camera height; 0 = stay continuous. */
function dataTickIntervalForHeight(heightM) {
  if (!(heightM >= 20_000)) return 0;
  if (heightM >= 2_000_000) return 1000;
  if (heightM >= 200_000) return 500;
  return 200;
}

function currentDataTickIntervalMs() {
  if (_cameraMoving || _holds.size === 0) return 0;
  for (const ownerId of _holds) if (!TICKED_DATA_HOLDS.has(ownerId)) return 0;
  return dataTickIntervalForHeight(
    _viewer.camera?.positionCartographic?.height,
  );
}

function setDataTickInterval(intervalMs) {
  if (intervalMs === _dataTickIntervalMs) return;
  clearInterval(_dataTickTimer);
  _dataTickTimer = null;
  _dataTickIntervalMs = intervalMs;
  if (intervalMs > 0)
    _dataTickTimer = setInterval(() => {
      if (!globalThis.document?.hidden) _viewer?.scene?.requestRender?.();
    }, intervalMs);
}

function applyFrameRate() {
  let fast = _cameraMoving;
  for (const ownerId of CAMERA_DRIVEN_HOLDS) fast ||= _holds.has(ownerId);
  // Low quality tier moves at 20 fps; parked cadence is tier-independent.
  const movingFrameRate = Math.min(
    MOVING_FRAME_RATE,
    getQualityPreset().movingFrameRate,
  );
  const frameRate = fast ? movingFrameRate : PARKED_FRAME_RATE;
  if (_viewer.targetFrameRate !== frameRate)
    _viewer.targetFrameRate = frameRate;
}

/** Debug trail of the most recent one-shot render requests (idle mode only). */
const _recentRequests = [];
const RECENT_REQUEST_CAP = 16;

function applyMode() {
  if (!_installed || !_viewer?.scene) return;
  applyFrameRate();
  const dataTickIntervalMs = currentDataTickIntervalMs();
  setDataTickInterval(dataTickIntervalMs);
  const continuous = _holds.size > 0 && dataTickIntervalMs === 0;
  const scene = _viewer.scene;
  if (scene.requestRenderMode === !continuous) return;
  scene.requestRenderMode = !continuous;
  if (!continuous) {
    // Entering idle: render one settling frame so anything the last
    // continuous frame mutated is on screen before the loop stops.
    scene.requestRender?.();
  }
}

/**
 * Install the governor on the viewer. Idempotent. Before install,
 * hold/release still record into the holds set (and apply at install time);
 * requests are safe no-ops — so modules can call all three unconditionally
 * in tests without a viewer.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function installRenderGovernor(viewer) {
  if (!viewer?.scene)
    throw new TypeError('installRenderGovernor requires a Cesium viewer');
  _removeCameraListeners?.();
  _viewer = viewer;
  _installed = true;
  _cameraMoving = false;
  const setCameraMoving = (moving) => {
    _cameraMoving = moving;
    applyMode();
  };
  // Camera-less test fakes skip the listeners and stay at the parked rate.
  const removeMoveStart = viewer.camera?.moveStart.addEventListener(() =>
    setCameraMoving(true),
  );
  const removeMoveEnd = viewer.camera?.moveEnd.addEventListener(() =>
    setCameraMoving(false),
  );
  _removeQualityListener?.();
  _removeQualityListener = onQualityTierChange(applyMode);
  _removeCameraListeners = () => {
    removeMoveStart?.();
    removeMoveEnd?.();
    _removeQualityListener?.();
    _removeQualityListener = null;
    _removeCameraListeners = null;
  };
  // Never let Cesium re-render on simulation-time deltas behind our back —
  // idle means idle. All re-renders are camera/tiles (Cesium-native) or
  // explicit requests.
  viewer.scene.maximumRenderTimeChange = Infinity;
  applyMode();
}

/**
 * Register a continuous-render hold. Idempotent per owner.
 * Call where the owner's per-frame work BEGINS (scene listener installed,
 * animation starts, tracking begins).
 * @param {string} ownerId Short stable id, e.g. 'flights', 'traffic'.
 * @returns {void}
 */
export function holdContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.add(ownerId);
  applyMode();
}

/**
 * Release a hold. Safe when never held.
 * Call where the owner's per-frame work ENDS (listener removed, animation
 * settled, tracking stopped, layer disabled).
 * @param {string} ownerId
 * @returns {void}
 */
export function releaseContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.delete(ownerId);
  applyMode();
}

/**
 * One-shot render request for a discrete scene mutation (layer tick, slider
 * write, annotation change). Always forwards to scene.requestRender() — in
 * continuous mode that is a harmless flag set (and forwarding closes the
 * request-then-last-release race); only idle/ticked-mode requests are
 * recorded in diagnostics. Cheap enough to call unconditionally after any mutation.
 * @param {string} [reason] For diagnostics only.
 * @returns {void}
 */
export function governorRequestRender(reason = 'unspecified') {
  if (!_installed || !_viewer?.scene) return;
  if (_viewer.scene.requestRenderMode) {
    _recentRequests.push({ reason, at: Date.now() });
    if (_recentRequests.length > RECENT_REQUEST_CAP) _recentRequests.shift();
  }
  _viewer.scene.requestRender?.();
}

/**
 * @returns {{installed: boolean, mode: 'continuous'|'ticked'|'idle',
 *   dataTickIntervalMs: number, holds: string[],
 *   recentRequests: Array<{reason: string, at: number}>}}
 */
export function getRenderGovernorDiagnostics() {
  let mode = 'idle';
  if (_holds.size > 0) mode = _dataTickIntervalMs > 0 ? 'ticked' : 'continuous';
  return {
    installed: _installed,
    mode,
    dataTickIntervalMs: _dataTickIntervalMs,
    holds: [..._holds].sort(),
    recentRequests: [..._recentRequests],
  };
}

/** Release the installed viewer after its animation owners have stopped. */
export function uninstallRenderGovernor(viewer) {
  if (_viewer !== viewer) return;
  _removeCameraListeners?.();
  setDataTickInterval(0);
  _viewer = null;
  _installed = false;
  _cameraMoving = false;
  _holds.clear();
  _recentRequests.length = 0;
}

/** Test seam: reset module state between unit tests. */
export function _resetRenderGovernorForTest() {
  _removeCameraListeners?.();
  setDataTickInterval(0);
  _cameraMoving = false;
  _viewer = null;
  _installed = false;
  _holds.clear();
  _recentRequests.length = 0;
}
