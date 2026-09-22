/**
 * Device quality tiers (2026-09-22). One tier is chosen at boot from GPU /
 * memory / core / battery signals, can drop at runtime (qualityWatchdog.js),
 * and the operator can pin one from DISPLAY ▸ Quality. Consumers read caps
 * through getQualityPreset() at use time and subscribe to live changes.
 */

/** @typedef {'unsupported'|'low'|'medium'|'high'} QualityTier */
/** @typedef {'auto'|'low'|'medium'|'high'} QualityOverride */

/**
 * @typedef {object} TierSignals
 * @property {string} renderer UNMASKED_RENDERER_WEBGL (or RENDERER) string.
 * @property {number|undefined} cores navigator.hardwareConcurrency.
 * @property {number|undefined} deviceMemoryGb navigator.deviceMemory.
 * @property {number} screenPixels screen.width * screen.height * dpr.
 * @property {boolean} onBattery Discharging (not charging); false if unknown.
 */

/**
 * @typedef {object} QualityPreset
 * @property {boolean} photoreal Create/show the Google photoreal tileset.
 * @property {{maximumScreenSpaceError: number, cacheBytes: number}|null} tileset
 * @property {number} resolutionScale viewer.resolutionScale.
 * @property {'off'|'sharpen'|'user'} postStages Which user post stages may run.
 * @property {number} vesselRows AIS billboard cap (Infinity = layer default).
 * @property {number} vesselLabels AIS label cap (Infinity = layer default).
 * @property {number} flightDots Flight dot cap (Infinity = FLIGHT_DOT_MAX).
 * @property {'off'|'proximity'|'user'} models Fleet 3D aircraft models.
 * @property {number} movingFrameRate Governor frame rate while moving.
 */

const MB = 1024 * 1024;

/** @type {Readonly<Record<'low'|'medium'|'high', Readonly<QualityPreset>>>} */
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    photoreal: false,
    tileset: null,
    resolutionScale: 0.6,
    postStages: 'off',
    vesselRows: 800,
    vesselLabels: 0,
    flightDots: 1000,
    models: 'off',
    movingFrameRate: 20,
  }),
  medium: Object.freeze({
    photoreal: true,
    tileset: Object.freeze({
      maximumScreenSpaceError: 48,
      cacheBytes: 256 * MB,
    }),
    resolutionScale: 0.85,
    postStages: 'sharpen',
    vesselRows: 2000,
    vesselLabels: 100,
    flightDots: 2500,
    models: 'proximity',
    movingFrameRate: 30,
  }),
  high: Object.freeze({
    photoreal: true,
    tileset: Object.freeze({
      maximumScreenSpaceError: 32,
      cacheBytes: 512 * MB,
    }),
    resolutionScale: 1,
    postStages: 'user',
    vesselRows: Infinity,
    vesselLabels: Infinity,
    flightDots: Infinity,
    models: 'user',
    movingFrameRate: 30,
  }),
});

const TIER_ORDER = ['low', 'medium', 'high'];
export const QUALITY_STORAGE_KEY = 'gev:quality:v1';
const AUTO_DROP_SESSION_KEY = 'gev:quality:auto-drop:v1';
const OVERRIDES = new Set(['auto', 'low', 'medium', 'high']);

/**
 * Pure tier rule (first match wins), then one step down on battery.
 * @param {TierSignals} signals
 * @returns {QualityTier}
 */
export function detectTier({
  renderer = '',
  cores,
  deviceMemoryGb,
  onBattery = false,
}) {
  if (/swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer))
    return 'unsupported';
  let tier = 'high';
  if (
    /intel.*(hd|uhd)|mali|adreno [1-5]|powervr/i.test(renderer) ||
    deviceMemoryGb <= 4 ||
    cores <= 4
  )
    tier = 'low';
  // No deviceMemory rule here: Chrome caps it at 8, so "≤ 8" would pin every
  // Chrome user to medium. Memory only decides the low tier (≤ 4).
  else if (/intel.*iris|radeon.*vega|apple m1\b/i.test(renderer))
    tier = 'medium';
  if (onBattery) tier = TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];
  return tier;
}

function readRenderer(documentRef) {
  const canvas = documentRef.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'software (no webgl)';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '',
  );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return renderer;
}

/**
 * Read the browser's tier signals. Battery is optional and bounded.
 * @returns {Promise<TierSignals>}
 */
export async function readSignals({
  navigatorRef = globalThis.navigator,
  screenRef = globalThis.screen,
  documentRef = globalThis.document,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
} = {}) {
  let onBattery = false;
  try {
    const battery = await Promise.race([
      navigatorRef.getBattery?.(),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
    onBattery = battery ? battery.charging === false : false;
  } catch {
    onBattery = false;
  }
  return {
    renderer: readRenderer(documentRef),
    cores: navigatorRef.hardwareConcurrency,
    deviceMemoryGb: navigatorRef.deviceMemory,
    screenPixels: Math.round(
      (screenRef?.width || 0) * (screenRef?.height || 0) * devicePixelRatio,
    ),
    onBattery,
  };
}

// ── Active tier state ────────────────────────────────────────────────────
// Before initQualityTier() (unit tests, tools) everything reads as `high`,
// which is the pre-tier behavior.
let _signals = null;
/** @type {QualityTier} */
let _detected = 'high';
/** @type {QualityOverride} */
let _override = 'auto';
/** @type {'low'|'medium'|null} */
let _autoDrop = null;
const _listeners = new Set();

function storage(kind) {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

function readStored(kind, key) {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(kind, key, value) {
  try {
    if (value == null) storage(kind)?.removeItem(key);
    else storage(kind)?.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the choice lasts for this page only.
  }
}

function lowerOf(a, b) {
  if (a === 'unsupported' || b === 'unsupported') return 'unsupported';
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];
}

/** @returns {QualityTier} The tier every consumer applies right now. */
export function getQualityTier() {
  if (_override !== 'auto') return _override;
  return _autoDrop ? lowerOf(_detected, _autoDrop) : _detected;
}

/** @returns {Readonly<QualityPreset>} Preset of the active tier. */
export function getQualityPreset() {
  const tier = getQualityTier();
  return QUALITY_PRESETS[tier === 'unsupported' ? 'low' : tier];
}

/** @returns {QualityOverride} */
export function getQualityOverride() {
  return _override;
}

function publish(previousTier, reason) {
  const tier = getQualityTier();
  if (globalThis.window)
    globalThis.window.__gevQuality = getQualityDiagnostics();
  if (tier === previousTier) return;
  for (const listener of [..._listeners]) {
    try {
      listener({ tier, previousTier, reason });
    } catch (error) {
      console.error('[Quality] tier listener failed', error);
    }
  }
}

/**
 * Detect the device tier and restore the stored override / session drop.
 * @returns {Promise<QualityTier>} The active tier.
 */
export async function initQualityTier(options) {
  try {
    _signals = await readSignals(options);
    _detected = detectTier(_signals);
  } catch (error) {
    console.warn('[Quality] signal read failed; assuming medium', error);
    _detected = 'medium';
  }
  const stored = readStored('localStorage', QUALITY_STORAGE_KEY);
  _override = OVERRIDES.has(stored) ? stored : 'auto';
  const drop = readStored('sessionStorage', AUTO_DROP_SESSION_KEY);
  _autoDrop = drop === 'low' || drop === 'medium' ? drop : null;
  publish(null, 'init');
  return getQualityTier();
}

/** Operator choice from DISPLAY ▸ Quality; persisted, never in share links. */
export function setQualityOverride(value) {
  if (!OVERRIDES.has(value) || value === _override) return;
  const previousTier = getQualityTier();
  _override = value;
  writeStored('localStorage', QUALITY_STORAGE_KEY, value);
  publish(previousTier, 'override');
}

/**
 * Runtime downgrade: one step below the active tier, Auto mode only, never
 * below low, never back up. Persists for this browser session.
 * @returns {'low'|'medium'|null} The new tier, or null when nothing dropped.
 */
export function dropQualityTier() {
  if (_override !== 'auto') return null;
  const previousTier = getQualityTier();
  const index = TIER_ORDER.indexOf(previousTier);
  if (index <= 0) return null;
  _autoDrop = /** @type {'low'|'medium'} */ (TIER_ORDER[index - 1]);
  writeStored('sessionStorage', AUTO_DROP_SESSION_KEY, _autoDrop);
  publish(previousTier, 'watchdog');
  return _autoDrop;
}

/**
 * @param {(change: {tier: QualityTier, previousTier: QualityTier|null, reason: string}) => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function onQualityTierChange(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Headless-readable snapshot (also mirrored on `window.__gevQuality`). */
export function getQualityDiagnostics() {
  return {
    tier: getQualityTier(),
    detected: _detected,
    override: _override,
    autoDrop: _autoDrop,
    signals: _signals,
  };
}

/** Cap a layer's configured count by the active tier. */
export function tierCap(configured, key) {
  return Math.min(configured, getQualityPreset()[key]);
}

/**
 * Fleet 3D-model coverage after the tier: 'off', or the operator's mode
 * narrowed to 'proximity' on medium.
 * @param {'proximity'|'all'} mode
 * @returns {'off'|'proximity'|'all'}
 */
export function tierModelsMode(mode) {
  const models = getQualityPreset().models;
  if (models === 'off') return 'off';
  return models === 'proximity' ? 'proximity' : mode;
}
