import { dropQualityTier } from './qualityTier.js';

/** Rolling window of rendered frames the median is taken over. */
const WINDOW_MS = 5000;
/** Fewest frames in the window before a verdict (≈ 4 fps sustained). */
const MIN_SAMPLES = 20;
/** No verdicts while shaders compile / first tiles stream, or right after a drop. */
const GRACE_MS = 10_000;
/** Gaps longer than this are pauses (idle, hidden tab), not slow frames. */
const MAX_FRAME_GAP_MS = 1000;
/** Parked data layers render at 15 fps by design; only sample faster targets. */
const MIN_SAMPLED_FRAME_RATE = 20;

const TIER_LABELS = { low: 'Low', medium: 'Medium' };

/**
 * Runtime downgrade: while the scene renders continuously at ≥ 20 fps target,
 * take the median interval between rendered frames over a rolling 5 s window;
 * above 50 ms (80 ms on low) drop one tier. Never upgrades. The postRender
 * listener only runs on frames that are drawn anyway — idle costs nothing.
 * @param {import('cesium').Viewer} viewer
 * @param {{getTier: () => string, now?: () => number}} options
 * @returns {() => void} Disposer.
 */
export function installQualityWatchdog(
  viewer,
  { getTier, now = () => performance.now() },
) {
  const scene = viewer.scene;
  const samples = [];
  let lastFrameAt = null;
  let graceUntil = now() + GRACE_MS;

  const onPostRender = () => {
    const t = now();
    if (
      scene.requestRenderMode ||
      viewer.targetFrameRate < MIN_SAMPLED_FRAME_RATE
    ) {
      lastFrameAt = null;
      return;
    }
    const previous = lastFrameAt;
    lastFrameAt = t;
    if (previous == null || t < graceUntil) return;
    const frameMs = t - previous;
    if (frameMs > MAX_FRAME_GAP_MS) return;
    samples.push({ t, frameMs });
    while (samples.length && samples[0].t < t - WINDOW_MS) samples.shift();
    if (samples.length < MIN_SAMPLES) return;
    const sorted = samples.map((s) => s.frameMs).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const limitMs = getTier() === 'low' ? 80 : 50;
    if (median <= limitMs) return;
    samples.length = 0;
    graceUntil = t + GRACE_MS;
    const dropped = dropQualityTier();
    if (dropped) showQualityToast(TIER_LABELS[dropped]);
  };

  const removePostRender = scene.postRender.addEventListener(onPostRender);
  return () => {
    removePostRender();
    document.getElementById('quality-toast')?.remove();
  };
}

function showQualityToast(tierLabel) {
  document.getElementById('quality-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'quality-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = `Switched to ${tierLabel} quality for smoother performance. Change it in DISPLAY ▸ Quality.`;
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.appendChild(close);
  document.body.appendChild(toast);
}
