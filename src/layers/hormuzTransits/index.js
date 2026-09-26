import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';

const LAYER_ID = 'hormuz-transits';
const ZONE_COLOR = Cesium.Color.fromCssColorString('#f2b84b').withAlpha(0.8);
const CAVEAT =
  'AISStream is a volunteer terrestrial receiver network — coverage in the ' +
  'strait and on the Iranian side is partial, and vessels outside receiver ' +
  'range are invisible. During the conflict many vessels transit with AIS ' +
  'off or spoofed, so this count is a lower bound of AIS-visible transits, ' +
  'not total traffic — it is not comparable to satellite-AIS figures cited ' +
  'elsewhere on the site (e.g. Windward). Ship type is unknown until a ' +
  'static report arrives. Bandar Abbas ↔ Qeshm coastal traffic never ' +
  "crosses both zones and isn't counted — that's intended.";

function rectangleOutline(box) {
  const [minLat, minLon, maxLat, maxLon] = box;
  return Cesium.Cartesian3.fromDegreesArray([
    minLon,
    minLat,
    maxLon,
    minLat,
    maxLon,
    maxLat,
    minLon,
    maxLat,
    minLon,
    minLat,
  ]);
}

function rectangleCenter(box) {
  const [minLat, minLon, maxLat, maxLon] = box;
  return Cesium.Cartesian3.fromDegrees(
    (minLon + maxLon) / 2,
    (minLat + maxLat) / 2,
  );
}

function formatUtcHm(epochMs) {
  if (!Number.isFinite(epochMs)) return '';
  return `${new Date(epochMs).toISOString().slice(11, 16)} UTC`;
}

/**
 * Own the Hormuz 24h transit counter: two static gate-zone outlines plus a
 * DOM HUD chip fed by the server-computed /api/ais-live/hormuz summary
 * (see server/providers/vessels/hormuz-transits.js for the zone-crossing
 * method — the browser only ever sees the newest ~3000 vessels worldwide, so
 * a 24h count has to live server-side).
 */
export function createHormuzTransitsLayer({ fetchImpl = fetch } = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _keyRequired = false;
  let _zonesKey = null; // JSON of the zones config currently drawn; rebuild only when it changes
  let _summary = null;
  let _chipEl = null;

  function ensureChip() {
    if (_chipEl) return;
    _chipEl = document.createElement('div');
    _chipEl.id = 'ms-hormuz-chip';
    _chipEl.setAttribute('role', 'status');
    _chipEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(_chipEl);
  }

  function removeChip() {
    if (_chipEl) _chipEl.remove();
    _chipEl = null;
  }

  function renderChip() {
    if (!_chipEl) return;
    if (_keyRequired) {
      _chipEl.textContent = 'HORMUZ 24H · needs AISSTREAM key';
      _chipEl.title = CAVEAT;
      return;
    }
    if (!_summary) {
      _chipEl.textContent = 'HORMUZ 24H · loading…';
      _chipEl.title = CAVEAT;
      return;
    }
    const {
      total,
      byType,
      inbound,
      outbound,
      partialWindow,
      trackingSince,
      feed,
    } = _summary;
    const line1 = `HORMUZ 24H · ${total} transits · ${byType.tanker} tankers · ${byType.cargo} cargo`;
    let line2 = `in ${inbound} · out ${outbound} · AIS coverage partial`;
    if (partialWindow) line2 += ` · since ${formatUtcHm(trackingSince)}`;
    if (feed?.status && feed.status !== 'live') line2 += ' · AIS feed stale';
    _chipEl.textContent = '';
    const l1 = document.createElement('div');
    l1.className = 'ms-hormuz-chip-line1';
    l1.textContent = line1;
    const l2 = document.createElement('div');
    l2.className = 'ms-hormuz-chip-line2';
    l2.textContent = line2;
    _chipEl.append(l1, l2);
    _chipEl.title = CAVEAT;
  }

  /**
   * Draw the gate zone outlines from the server's /api/ais-live/hormuz
   * `summary.zones` payload (server/providers/vessels/hormuz-transits.js's
   * HORMUZ_ZONES) instead of a duplicated hardcoded copy here, so there's
   * one source of truth. Rebuilds only when the zones config actually
   * changes (compared by value), not on every update().
   */
  function buildZonesFromSummary(zones) {
    if (!zones || !_dataSource) return;
    const key = JSON.stringify(zones);
    if (key === _zonesKey) return;
    _dataSource.entities.removeAll();
    for (const [name, box] of Object.entries(zones)) {
      _dataSource.entities.add(
        new Cesium.Entity({
          id: `${LAYER_ID}:zone:${name}`,
          polyline: {
            positions: rectangleOutline(box),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
              color: ZONE_COLOR,
              dashLength: 12,
            }),
            clampToGround: true,
          },
        }),
      );
      _dataSource.entities.add(
        new Cesium.Entity({
          id: `${LAYER_ID}:label:${name}`,
          position: rectangleCenter(box),
          label: {
            text: `${name.toUpperCase()} GATE`,
            font: '11px monospace',
            fillColor: ZONE_COLOR,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
    _zonesKey = key;
    governorRequestRender('hormuz-transits:zones');
  }

  return {
    id: LAYER_ID,
    name: 'Hormuz Transits (24h)',
    icon: '⇄',
    source: 'AISStream · computed',
    updateInterval: 120_000,
    requiresKeyId: 'aisstream',

    init(viewer) {
      if (_viewer)
        throw new Error('Hormuz transits layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      _lastError = null;
      _lastUpdate = null;
      _keyRequired = false;
      _zonesKey = null;
      _summary = null;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      // Zones only known once the first summary has arrived; if we already
      // have one (re-enable case), redraw immediately instead of waiting for
      // the next update() tick.
      if (_summary?.zones) buildZonesFromSummary(_summary.zones);
      ensureChip();
      renderChip();
      // Zone entities are built once and update() always returns false (it's
      // DOM-only), so neither the first build nor a re-enable ever triggers
      // a render on its own — always request one here after the scene change.
      governorRequestRender('hormuz-transits:enable');
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeChip();
      governorRequestRender('hormuz-transits:disable');
    },

    async update() {
      if (!_enabled) return false;
      _abort?.abort();
      const controller = new AbortController();
      _abort = controller;
      try {
        const response = await fetchImpl('/api/ais-live/hormuz', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (controller.signal.aborted || _abort !== controller || !_enabled)
          return false;

        if (response.status === 503) {
          _keyRequired = true;
          _summary = null;
          _lastUpdate = Date.now();
          _lastError = null;
          renderChip();
          return true;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        _keyRequired = false;
        _summary = await response.json();
        _lastUpdate = Date.now();
        _lastError = null;
        if (_summary?.zones) buildZonesFromSummary(_summary.zones);
        renderChip();
        // `false` means "rejected" to the lifecycle (it rolls the enable back
        // to OFF), so a successful poll must return true.
        return true;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:HormuzTransits] Fetch error:', error);
        _lastError = error?.message || 'Hormuz transit summary unavailable';
        return false;
      } finally {
        if (_abort === controller) _abort = null;
      }
    },

    destroy(viewer = _viewer) {
      _abort?.abort();
      _abort = null;
      removeChip();
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _enabled = false;
      _zonesKey = null;
      _summary = null;
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
    },

    getStats() {
      return {
        count: _summary?.total ?? 0,
        // A live zero is a real reading; the panel shows "—" for a falsy count.
        countLabel: _summary ? String(_summary.total ?? 0) : undefined,
        lastUpdate: _lastUpdate,
        error: _lastError,
        keyRequired: _keyRequired,
      };
    },

    getRowControls() {
      const byType = _summary?.byType || {
        tanker: 0,
        cargo: 0,
        other: 0,
        unknown: 0,
      };
      return {
        chips: [],
        legend: [
          { label: 'Tanker', color: '#ec1313', count: byType.tanker },
          { label: 'Cargo', color: '#f2b84b', count: byType.cargo },
          { label: 'Other', color: '#f1e9e4', count: byType.other },
          { label: 'Unknown', color: '#b08a78', count: byType.unknown },
        ],
      };
    },
  };
}
