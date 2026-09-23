import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { hexVertices } from './hex.js';

const LAYER_ID = 'gps-interference';
const OK_MIN_TOTAL_TO_SHOW = 10;

const CAVEAT =
  'Share of aircraft reporting degraded GPS accuracy (ADS-B NACp<8). ' +
  'Consistent with jamming or spoofing but not proof; no data where no ' +
  'aircraft fly or no receivers exist (most of Iran).';

const HEURISTIC_NOTE =
  'Heuristic: NACp<8 is not gpsjam.org’s own (undisclosed) threshold, ' +
  'just the usual ADS-B-mandate accuracy floor (EPU<93m) used here as a ' +
  'stand-in for "degraded".';

const STATUS = Object.freeze({
  red: { color: '#ec1313', alpha: 0.55, label: '>10% degraded' },
  yellow: { color: '#f2b84b', alpha: 0.45, label: '2–10%' },
  ok: { color: '#5a3a30', alpha: 0.25, label: 'normal' },
});

function classify(pctBad) {
  if (pctBad > 10) return 'red';
  if (pctBad > 2) return 'yellow';
  return 'ok';
}

function cellEntityId(q, r) {
  return `${LAYER_ID}:${q}_${r}`;
}

/**
 * Own the GPS-interference hex-grid display: one flat polygon per 0.5° hex
 * cell, coloured by the server-computed (gpsjam.org-style) share of nearby
 * ADS-B aircraft reporting a degraded NACp over the trailing 24h. See
 * server/providers/aircraft/gps-interference.js for the poller and method.
 * Heuristic and explicitly labelled as such — see CAVEAT.
 */
export function createGpsInterferenceLayer({ fetchImpl = fetch } = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _count = 0;
  let _legend = [];
  let _recordsByEntityId = new Map();
  let _cardOpen = false;

  function showCardFor(record) {
    const pct = record.pctBad.toFixed(1);
    showInfoCard({
      owner: LAYER_ID,
      title: 'GPS accuracy cell',
      rows: [
        ['Aircraft (24h)', String(record.good + record.bad)],
        ['Degraded', `${record.bad} (${pct}%)`],
        ['Centre', `${record.lat.toFixed(2)}, ${record.lon.toFixed(2)}`],
      ],
      note: CAVEAT,
      link: { href: 'https://gpsjam.org', label: 'Compare: gpsjam.org →' },
    });
    _cardOpen = true;
    governorRequestRender(`${LAYER_ID}:card`);
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
      } else if (_cardOpen) {
        hideInfoCard(LAYER_ID);
        _cardOpen = false;
        governorRequestRender(`${LAYER_ID}:card`);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function buildEntities(cells, cellDeg) {
    const nextEntities = [];
    const nextRecords = new Map();
    let redCount = 0;
    let yellowCount = 0;
    let okCount = 0;

    for (const cell of cells) {
      const total = cell.good + cell.bad;
      const status = classify(cell.pctBad);
      if (status === 'ok') {
        if (total < OK_MIN_TOTAL_TO_SHOW) continue;
        okCount++;
      } else if (status === 'yellow') {
        yellowCount++;
      } else {
        redCount++;
      }

      const { color, alpha } = STATUS[status];
      const positions = Cesium.Cartesian3.fromDegreesArray(
        hexVertices(cell.q, cell.r, cellDeg).flat(),
      );
      const id = cellEntityId(cell.q, cell.r);
      const entity = new Cesium.Entity({
        id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
          classificationType: Cesium.ClassificationType.BOTH,
        },
      });
      nextEntities.push(entity);
      nextRecords.set(id, cell);
    }

    _dataSource.entities.removeAll();
    for (const entity of nextEntities) _dataSource.entities.add(entity);
    _recordsByEntityId = nextRecords;
    _count = nextEntities.length;
    _legend = [
      { label: STATUS.red.label, color: STATUS.red.color, count: redCount },
      {
        label: STATUS.yellow.label,
        color: STATUS.yellow.color,
        count: yellowCount,
      },
      {
        label: STATUS.ok.label,
        color: STATUS.ok.color,
        count: okCount,
      },
      {
        label: 'Heuristic — read the caveat',
        color: 'transparent',
        count: redCount + yellowCount + okCount,
        blurb: `${CAVEAT} ${HEURISTIC_NOTE}`,
      },
    ];
  }

  return {
    id: LAYER_ID,
    name: 'GPS Interference (24h)',
    icon: '⌖',
    source: 'adsb.lol · computed',
    updateInterval: 600_000,

    init(viewer) {
      if (_viewer)
        throw new Error('GPS interference layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installInteraction(viewer);
      _enabled = false;
      _lastError = null;
      _lastUpdate = null;
      _count = 0;
      _legend = [];
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      // update() only re-renders on a genuinely new snapshot, so a fresh
      // enable (or re-enable before the next 10-min tick) needs its own
      // render request — otherwise the just-shown scene change never paints.
      governorRequestRender(`${LAYER_ID}:enable`);
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      _cardOpen = false;
      governorRequestRender(`${LAYER_ID}:disable`);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _abort?.abort();
      const controller = new AbortController();
      _abort = controller;
      try {
        const response = await fetchImpl('/api/gps-interference', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (controller.signal.aborted || _abort !== controller || !_enabled)
          return false;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (controller.signal.aborted || _abort !== controller || !_enabled)
          return false;

        const cellDeg = Number(payload?.cellDeg) || 0.5;
        const cells = Array.isArray(payload?.cells) ? payload.cells : [];
        buildEntities(cells, cellDeg);
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:GpsInterference] Fetch error:', error);
        _lastError = error?.message || 'GPS interference grid unavailable';
        return false;
      } finally {
        if (_abort === controller) _abort = null;
      }
    },

    destroy(viewer = _viewer) {
      _abort?.abort();
      _abort = null;
      hideInfoCard(LAYER_ID);
      _cardOpen = false;
      if (_handler) {
        _handler.destroy();
        _handler = null;
      }
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _recordsByEntityId = new Map();
      _enabled = false;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },

    getRowControls() {
      return { chips: [], legend: _legend };
    },
  };
}
