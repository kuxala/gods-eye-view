import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import {
  getQualityTier,
  initQualityTier,
  setQualityOverride,
} from './qualityTier.js';

let application = null;

/** Software-GL devices get a static note instead of a Cesium viewer. */
function renderUnsupportedPanel() {
  const content = document.querySelector('#loading-screen .loader-content');
  const status = content.querySelector('.loader-status');
  status.textContent = "Your device can't run the live globe.";
  status.style.animation = 'none';
  const link = document.createElement('a');
  link.href = 'https://militaryspend.org/us-iran-war';
  link.target = '_top';
  link.className = 'quality-fallback-link';
  link.textContent = 'Read the US–Iran war tracker on MilitarySpend →';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'quality-fallback-retry';
  retry.textContent = 'Try Low quality anyway';
  retry.addEventListener('click', () => {
    setQualityOverride('low');
    window.location.reload();
  });
  content.append(link, retry);
}

function startGlobe() {
  application = createStandaloneApplication({
    googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
    allowQaRegistration: import.meta.env.DEV,
  });
  return application.start();
}

/** `?quality=low` (the site's "Lite mode" link) pins a tier, persisted. */
function applyQualityParam() {
  const value = new URLSearchParams(window.location.search).get('quality');
  if (value) setQualityOverride(value);
}

// The tier decides whether a Cesium viewer is created at all.
initQualityTier()
  .then(() => {
    applyQualityParam();
    return getQualityTier() === 'unsupported'
      ? renderUnsupportedPanel()
      : startGlobe();
  })
  .catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  });

export { application };
