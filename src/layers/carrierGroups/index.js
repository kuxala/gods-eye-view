import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';

const LAYER_ID = 'carrier-groups';
const GLYPH_SIZE_PX = 22;
const GLYPH_COLOR = '#ec1313';
const GLYPH_OUTLINE_COLOR = '#f1e9e4';
const RING_RADIUS_M = 150_000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const HIDE_MS = 30 * 24 * 60 * 60 * 1000;
const NO_DATA_ERROR =
  'No carrier positions yet — owner updates public/ms/carrier-groups.json';
const STALE_ERROR = 'carrier data older than 30 days';
const PRECISION_LABELS = {
  'sea-area': 'Sea area only — not a precise position',
  'reported-port': 'Reported port — not a precise position',
};

/*
 * public/ms/carrier-groups.json schema (hand-updated — no fetch/scrape):
 * {
 *   "schema": 1,
 *   "asOf": "2026-09-14" | null,             // fallback asOf for entries that omit it
 *   "source": { "name": "USNI News Fleet and Marine Tracker", "url": "https://…" | null },
 *   "note": "…",
 *   "groups": [
 *     {
 *       "id": "cvn-77",
 *       "name": "USS George H.W. Bush (CVN-77)",
 *       "kind": "CSG" | "ARG",
 *       "area": "Arabian Sea",
 *       "at": [lat, lon],
 *       "precision": "sea-area" | "reported-port",
 *       "asOf": "2026-09-14",
 *       "sourceUrl": "https://news.usni.org/…",
 *       "escorts": ["USS …"],
 *       "note": ""
 *     }
 *   ]
 * }
 *
 * Suggested representative points (owner copies as needed):
 *   North Arabian Sea    [21.5, 62.5]
 *   Gulf of Oman         [24.8, 58.3]
 *   Red Sea (north)      [25.0, 35.8]
 *   Red Sea (south)      [15.5, 41.5]
 *   Eastern Mediterranean [34.0, 32.5]
 *   Persian Gulf         [27.0, 51.5]
 */

/** Draw the flat-deck carrier glyph once per module (never per entity). */
function buildGlyphCanvas() {
  const size = GLYPH_SIZE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Simple flat-deck silhouette: a long thin hull with a squared bow.
  ctx.beginPath();
  ctx.moveTo(size * 0.12, size * 0.42);
  ctx.lineTo(size * 0.78, size * 0.42);
  ctx.lineTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.78, size * 0.58);
  ctx.lineTo(size * 0.12, size * 0.58);
  ctx.lineTo(size * 0.05, size * 0.5);
  ctx.closePath();
  ctx.fillStyle = GLYPH_COLOR;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = GLYPH_OUTLINE_COLOR;
  ctx.stroke();
  // Island superstructure.
  ctx.fillStyle = GLYPH_OUTLINE_COLOR;
  ctx.fillRect(size * 0.58, size * 0.28, size * 0.1, size * 0.14);
  return canvas;
}

function shortName(name) {
  const initials = String(name || '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word))
    .map((word) => word[0])
    .join('');
  return initials || name;
}

function formatShortDate(asOf) {
  if (!asOf) return '';
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function isFiniteLatLon(at) {
  return (
    Array.isArray(at) &&
    at.length === 2 &&
    Number.isFinite(at[0]) &&
    Number.isFinite(at[1])
  );
}

/** Own the placeholder carrier strike group display: hand-updated JSON, no scraping. */
export function createCarrierGroupsLayer({ fetchImpl = fetch } = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _lastHash = null;
  let _count = 0;
  let _recordsByEntityId = new Map();
  let _glyphCanvas = null;
  let _cardOpen = false;

  function glyphImage() {
    if (!_glyphCanvas) _glyphCanvas = buildGlyphCanvas();
    return _glyphCanvas;
  }

  function showGroupCard(group) {
    showInfoCard({
      owner: LAYER_ID,
      title: group.name,
      rows: [
        ['Area', group.area || 'Unknown'],
        ['As of', group.asOf || 'Unknown'],
        [
          'Precision',
          PRECISION_LABELS[group.precision] ||
            'Approximate — not a precise position',
        ],
        ['Escorts', (group.escorts || []).join(', ') || 'None listed'],
      ],
      note: group.note || undefined,
      link: {
        href: group.sourceUrl,
        label: 'USNI Fleet Tracker →',
      },
    });
    _cardOpen = true;
    governorRequestRender('carrier-groups:card');
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
        showGroupCard(record);
      } else if (_cardOpen) {
        hideInfoCard(LAYER_ID);
        _cardOpen = false;
        governorRequestRender('carrier-groups:card');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function buildEntities(data) {
    const now = Date.now();
    const topAsOf = data.asOf || null;
    const nextEntities = [];
    const nextRecords = new Map();
    let visibleCount = 0;
    let sawStale = false;
    let sawExpired = false;

    for (const group of data.groups || []) {
      if (!group?.name || !isFiniteLatLon(group.at)) continue;
      const asOf = group.asOf || topAsOf;
      if (!asOf) continue;
      const ageMs = now - new Date(`${asOf}T00:00:00Z`).getTime();
      if (!Number.isFinite(ageMs)) continue;
      if (ageMs > HIDE_MS) {
        sawExpired = true;
        continue;
      }
      const stale = ageMs > STALE_MS;
      if (stale) sawStale = true;
      const alpha = stale ? 0.5 : 1;

      const [lat, lon] = group.at;
      const position = Cesium.Cartesian3.fromDegrees(lon, lat);
      const labelText = `${shortName(group.name)} · ${group.area || 'Unknown'} · ${formatShortDate(asOf)}${stale ? ' (stale)' : ''}`;
      const entityId = `carrier-groups:${group.id || group.name}`;
      // Two owner-authored rows sharing an id/name would collide and
      // entities.add() throws forever — skip the duplicate.
      if (nextRecords.has(entityId)) continue;

      const entity = new Cesium.Entity({
        id: entityId,
        position,
        billboard: {
          image: glyphImage(),
          width: GLYPH_SIZE_PX,
          height: GLYPH_SIZE_PX,
          color: Cesium.Color.WHITE.withAlpha(alpha),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: labelText,
          font: '11px monospace',
          fillColor:
            Cesium.Color.fromCssColorString('#f1e9e4').withAlpha(alpha),
          showBackground: true,
          backgroundColor:
            Cesium.Color.fromCssColorString('rgba(18,10,10,0.7)').withAlpha(
              alpha,
            ),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, 18),
        },
        ellipse: {
          semiMajorAxis: RING_RADIUS_M,
          semiMinorAxis: RING_RADIUS_M,
          height: 0,
          fill: false,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(GLYPH_COLOR).withAlpha(
            0.4 * alpha,
          ),
        },
      });
      nextEntities.push(entity);
      nextRecords.set(entityId, { ...group, asOf });
      visibleCount++;
    }

    _dataSource.entities.removeAll();
    for (const entity of nextEntities) _dataSource.entities.add(entity);
    _recordsByEntityId = nextRecords;
    _count = visibleCount;
    return { visibleCount, sawStale, sawExpired };
  }

  return {
    id: LAYER_ID,
    name: 'US Carrier Groups',
    icon: '⚓',
    source: 'USNI Fleet Tracker (manual)',
    updateInterval: 3_600_000,

    init(viewer) {
      if (_viewer)
        throw new Error('Carrier groups layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('carrier-groups');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installInteraction(viewer);
      _enabled = false;
      _lastError = null;
      _lastUpdate = null;
      _lastHash = null;
      _count = 0;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('carrier-groups:enable');
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      _cardOpen = false;
      governorRequestRender('carrier-groups:disable');
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _abort?.abort();
      const controller = new AbortController();
      _abort = controller;
      try {
        const base = import.meta.env?.BASE_URL || '/';
        const response = await fetchImpl(`${base}ms/carrier-groups.json`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`carrier-groups.json: ${response.status}`);
        const raw = await response.text();
        if (controller.signal.aborted || _abort !== controller || !_enabled)
          return false;

        const hash = raw;
        if (hash === _lastHash) {
          _lastError = null;
          return false;
        }

        const data = JSON.parse(raw);
        const { visibleCount, sawExpired } = buildEntities(data);
        _lastHash = hash;
        _lastUpdate = Date.now();
        if (!data.groups || data.groups.length === 0 || !data.asOf) {
          _lastError = NO_DATA_ERROR;
        } else if (visibleCount === 0 && sawExpired) {
          _lastError = STALE_ERROR;
        } else {
          _lastError = null;
        }
        return true;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:CarrierGroups] Fetch error:', error);
        _lastError = error?.message || 'Carrier groups unavailable';
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
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      _recordsByEntityId = new Map();
      _enabled = false;
      _count = 0;
      _lastUpdate = null;
      _lastHash = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
}
