import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { adaptFirmsRecords } from '../../data/firmsAdapt.js';
import { regionFor } from './regions.js';

const LAYER_ID = 'firms-strike-candidates';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTITIES = 1500;
const DIAMOND_SIZE_PX = 14;
const COLOR_HIGH = '#ff3b2f';
const COLOR_LOW = '#f2b84b';
const PERSISTENT_CELL_DEG = 0.02;
const HONESTY_NOTE =
  'Possible strike — unverified. Thermal anomaly only; oil/gas flares, ' +
  'refinery fires and crop burning also appear.';

/**
 * Draw a hollow diamond once per module (never per entity). `filled` draws a
 * translucent fill for the high/nominal-confidence style; the low-confidence
 * style is outline-only.
 */
function buildDiamondCanvas(color, filled) {
  const size = DIAMOND_SIZE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(half, 1);
  ctx.lineTo(size - 1, half);
  ctx.lineTo(half, size - 1);
  ctx.lineTo(1, half);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = `${color}55`;
    ctx.fill();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  return canvas;
}

function classifyConfidence(confidence) {
  if (confidence < 0.5) return 'low';
  if (confidence < 0.8) return 'nominal';
  return 'high';
}

function formatUtc(acqMs) {
  if (!Number.isFinite(acqMs) || acqMs <= 0) return 'Unknown';
  return `${new Date(acqMs).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function persistentCellKey(lat, lon) {
  const cellLat = Math.floor(lat / PERSISTENT_CELL_DEG) * PERSISTENT_CELL_DEG;
  const cellLon = Math.floor(lon / PERSISTENT_CELL_DEG) * PERSISTENT_CELL_DEG;
  return `${cellLat.toFixed(2)}_${cellLon.toFixed(2)}`;
}

/**
 * Own the FIRMS strike-candidate display: hollow-diamond billboards over the
 * six Iran-war-theatre watch boxes, reusing the shared `sources.firms` feed
 * (no extra live-fire quota — the heatmap layer in src/layers/firms/ already
 * pays that cost). Drops detections the server's persistent-flare mask
 * (GET /api/firms/persistent, T4b) marks as permanent oil/gas flares; when
 * that endpoint is unavailable (keyless, or upstream down) the mask is
 * simply empty and every detection in the boxes shows — degrades
 * gracefully, never blocks the layer.
 */
export function createStrikeCandidatesLayer({ feed } = {}) {
  if (typeof feed?.getSnapshot !== 'function')
    throw new TypeError('Strike candidates require a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _keyRequired = false;
  let _count = 0;
  let _legend = [];
  let _recordsByEntityId = new Map();
  /** @type {Set<string>} persistent-flare cell keys, empty when the mask is unavailable */
  let _persistentCells = new Set();
  let _persistentFetched = false;

  const diamondHigh = buildDiamondCanvas(COLOR_HIGH, true);
  const diamondLow = buildDiamondCanvas(COLOR_LOW, false);

  async function fetchPersistentMask(signal) {
    if (_persistentFetched) return;
    try {
      const response = await fetch('/api/firms/persistent', {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload?.cells))
        _persistentCells = new Set(payload.cells);
      // Only mark fetched on success — a failed/aborted first fetch must
      // leave the mask empty but retry-able on the next update(), not stuck
      // empty for the rest of the session.
      _persistentFetched = true;
    } catch {
      // Keyless / upstream down / network error — mask stays empty, the
      // layer still works, it just doesn't suppress flares; will retry.
    }
  }

  function showCardFor(record) {
    const region = regionFor(record.lat, record.lon);
    showInfoCard({
      owner: LAYER_ID,
      title: `Thermal anomaly — ${region?.label ?? 'Unknown region'}`,
      rows: [
        ['Detected', formatUtc(record.acqMs)],
        ['Satellite', `${record.satellite}/${record.sensor}`],
        ['Fire radiative power', `${record.frp.toFixed(1)} MW`],
        ['Confidence', classifyConfidence(record.confidence)],
        ['Position', `${record.lat.toFixed(4)}, ${record.lon.toFixed(4)}`],
      ],
      note: HONESTY_NOTE,
      link: {
        href: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${record.lon},${record.lat},10z`,
        label: 'Open in NASA FIRMS →',
      },
    });
    governorRequestRender('firms-strike-candidates:card');
  }

  function installInteraction(viewer) {
    if (_handler) return;
    _handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _handler.setInputAction((click) => {
      if (!isPointerFree()) return;
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const record = picked?.id?.id
        ? _recordsByEntityId.get(picked.id.id)
        : null;
      if (record) {
        showCardFor(record);
      } else {
        hideInfoCard(LAYER_ID);
        governorRequestRender('firms-strike-candidates:card');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function buildEntities(fires) {
    const nowMs = Date.now();
    const cutoffMs = nowMs - DAY_MS;
    let hidden = 0;
    const candidates = [];
    for (const fire of fires) {
      if (fire.acqMs < cutoffMs) continue;
      const region = regionFor(fire.lat, fire.lon);
      if (!region) continue;
      if (_persistentCells.has(persistentCellKey(fire.lat, fire.lon))) {
        hidden++;
        continue;
      }
      candidates.push(fire);
    }
    candidates.sort((a, b) => b.frp - a.frp);
    const kept = candidates.slice(0, MAX_ENTITIES);

    const nextEntities = [];
    const nextRecords = new Map();
    let highCount = 0;
    let lowCount = 0;
    for (const fire of kept) {
      const id = `firms-strike:${fire.lat.toFixed(4)},${fire.lon.toFixed(4)},${fire.acqMs}`;
      // Two fires rounding to the same lat/lon/acqMs would collide and
      // entities.add() throws forever — skip the duplicate.
      if (nextRecords.has(id)) continue;
      const low = fire.confidence < 0.5;
      if (low) lowCount++;
      else highCount++;
      const entity = new Cesium.Entity({
        id,
        position: Cesium.Cartesian3.fromDegrees(fire.lon, fire.lat),
        billboard: {
          image: low ? diamondLow : diamondHigh,
          width: DIAMOND_SIZE_PX,
          height: DIAMOND_SIZE_PX,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      nextEntities.push(entity);
      nextRecords.set(id, fire);
    }

    _dataSource.entities.removeAll();
    for (const entity of nextEntities) _dataSource.entities.add(entity);
    _recordsByEntityId = nextRecords;
    _count = nextEntities.length;
    _legend = [
      { label: 'High/nominal', color: COLOR_HIGH, count: highCount },
      { label: 'Low confidence', color: COLOR_LOW, count: lowCount },
      {
        label: 'Unverified — flares & crop fires also appear',
        color: 'transparent',
        count: nextEntities.length,
        blurb: hidden
          ? `${HONESTY_NOTE} Hidden: ${hidden} likely flares.`
          : HONESTY_NOTE,
      },
    ];
  }

  return {
    id: LAYER_ID,
    name: 'Strike Candidates (FIRMS 24h)',
    icon: '◇',
    source: 'NASA FIRMS · LIVE',
    updateInterval: 600_000,
    requiresKeyId: 'firms',

    init(viewer) {
      if (_viewer)
        throw new Error('Strike candidates layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('firms-strike-candidates');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installInteraction(viewer);
      _enabled = false;
      _lastError = null;
      _lastUpdate = null;
      _keyRequired = false;
      _count = 0;
      _legend = [];
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      // update() short-circuits when the feed hasn't changed since the last
      // successful render, so a re-enable needs its own render request.
      if (_lastUpdate) governorRequestRender('firms-strike-candidates:enable');
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      governorRequestRender('firms-strike-candidates:disable');
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _abort?.abort();
      const controller = new AbortController();
      _abort = controller;
      try {
        await fetchPersistentMask(controller.signal);
        if (controller.signal.aborted || _abort !== controller) return false;

        const snapshot = await feed.getSnapshot({ signal: controller.signal });
        if (controller.signal.aborted || _abort !== controller || !_enabled)
          return false;

        if (snapshot?.keyRequired) {
          _keyRequired = true;
          _dataSource.entities.removeAll();
          _recordsByEntityId = new Map();
          _count = 0;
          _legend = [];
          _lastUpdate = Date.now();
          _lastError = null;
          return true;
        }
        _keyRequired = false;

        const fires = adaptFirmsRecords(snapshot.fires);
        buildEntities(fires);
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:StrikeCandidates] Fetch error:', error);
        _lastError = error?.message || 'Strike candidates unavailable';
        return false;
      } finally {
        if (_abort === controller) _abort = null;
      }
    },

    destroy(viewer = _viewer) {
      _abort?.abort();
      _abort = null;
      hideInfoCard(LAYER_ID);
      if (_handler) {
        _handler.destroy();
        _handler = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      _recordsByEntityId = new Map();
      _enabled = false;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
      _persistentFetched = false;
      _persistentCells = new Set();
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        keyRequired: _keyRequired,
      };
    },

    getRowControls() {
      return { chips: [], legend: _legend };
    },
  };
}
