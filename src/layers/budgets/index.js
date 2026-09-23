import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';

const LAYER_ID = 'military-budgets';

// Log-scale bins on 2026 defence spend (USD), warm ramp — no blue/cyan hues.
const SPEND_BINS = Object.freeze([
  { max: 1e9, label: '<$1B', color: '#4a2622' },
  { max: 5e9, label: '$1–$5B', color: '#7a2a20' },
  { max: 20e9, label: '$5–$20B', color: '#a8261a' },
  { max: 100e9, label: '$20–$100B', color: '#d11a12' },
  { max: Infinity, label: '≥$100B', color: '#ff3b2f' },
]);

function binFor(spendUsd) {
  return (
    SPEND_BINS.find((bin) => spendUsd < bin.max) ||
    SPEND_BINS[SPEND_BINS.length - 1]
  );
}

function formatSpend(spendUsd, isEstimate) {
  const billions = spendUsd / 1e9;
  const value =
    billions >= 100 ? `$${Math.round(billions)}B` : `$${billions.toFixed(1)}B`;
  return isEstimate ? `${value} (est.)` : value;
}

/** Build one entity's PolygonHierarchy (with holes) for a GeoJSON ring set. */
function hierarchyFromRings(rings) {
  const toPositions = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flat());
  const [outer, ...holes] = rings;
  return new Cesium.PolygonHierarchy(
    toPositions(outer),
    holes.map((hole) => new Cesium.PolygonHierarchy(toPositions(hole))),
  );
}

/** Own the military budget choropleth display. */
export function createMilitaryBudgetsLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _loaded = false;
  let _loading = false;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _recordsByEntityId = new Map();
  let _legend = [];

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  function buildEntities(budgets, geo) {
    const geoByTopoName = new Map(
      geo.features.map((feature) => [feature.properties.name, feature]),
    );
    const binCounts = new Map(SPEND_BINS.map((bin) => [bin.label, 0]));
    const nextEntities = [];

    for (const country of budgets.countries) {
      const bin = binFor(country.spendUsd);
      binCounts.set(bin.label, (binCounts.get(bin.label) || 0) + 1);
      const color = Cesium.Color.fromCssColorString(bin.color);

      if (country.point) {
        const entity = new Cesium.Entity({
          id: `budget:${country.code}:point`,
          position: Cesium.Cartesian3.fromDegrees(
            country.point[0],
            country.point[1],
          ),
          point: {
            pixelSize: 9,
            color,
            outlineColor: Cesium.Color.fromCssColorString('#f1e9e4'),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        nextEntities.push(entity);
        _recordsByEntityId.set(entity.id, country);
        continue;
      }

      const feature = geoByTopoName.get(country.topoName);
      if (!feature) continue;
      const polygons =
        feature.geometry.type === 'MultiPolygon'
          ? feature.geometry.coordinates
          : [feature.geometry.coordinates];

      polygons.forEach((rings, index) => {
        const entity = new Cesium.Entity({
          id: `budget:${country.code}:${index}`,
          polygon: {
            hierarchy: hierarchyFromRings(rings),
            material: color.withAlpha(0.42),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        nextEntities.push(entity);
        _recordsByEntityId.set(entity.id, country);
      });
    }

    _dataSource.entities.removeAll();
    for (const entity of nextEntities) _dataSource.entities.add(entity);

    _legend = SPEND_BINS.map((bin) => ({
      label: bin.label,
      color: bin.color,
      count: binCounts.get(bin.label) || 0,
    }));
  }

  function showCardFor(country) {
    showInfoCard({
      owner: LAYER_ID,
      title: country.name,
      rows: [
        [
          '2026 defence budget',
          formatSpend(country.spendUsd, country.spendIsEstimate),
        ],
        ['% of GDP', `${country.pctGdp}%`],
        ['World rank', `#${country.rank}`],
      ],
      note: 'SIPRI 2025 actuals',
      link: {
        href: `https://militaryspend.org/country-profiles/${country.slug}`,
        label: 'Full profile on MilitarySpend.org →',
      },
    });
    governorRequestRender('military-budgets:card');
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
        governorRequestRender('military-budgets:card');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  return {
    id: LAYER_ID,
    name: 'Military Budgets 2026',
    icon: '$',
    source: 'MilitarySpend.org · SIPRI',

    init(viewer) {
      if (_viewer)
        throw new Error('Military budgets layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('military-budgets');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installInteraction(viewer);
      _loaded = false;
      _loading = false;
      _enabled = false;
      _lastError = null;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      governorRequestRender('military-budgets:disable');
    },

    async update() {
      if (!_enabled || _loaded || _loading) return false;
      _loading = true;
      const controller = new AbortController();
      _abort = controller;
      try {
        const base = import.meta.env?.BASE_URL || '/';
        const [budgets, geo] = await Promise.all([
          fetchJson(`${base}ms/country-budgets.json`, controller.signal),
          fetchJson(`${base}ms/countries-110m.geojson`, controller.signal),
        ]);
        if (controller.signal.aborted || _abort !== controller) return false;
        buildEntities(budgets, geo);
        _loaded = true;
        _lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:MilitaryBudgets] Fetch error:', error);
        _lastError = error?.message || 'Military budgets unavailable';
        return false;
      } finally {
        _loading = false;
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
      _loaded = false;
      _enabled = false;
    },

    getStats() {
      return {
        loading: _loading,
        error: _lastError,
        count: _recordsByEntityId.size,
      };
    },

    getRowControls() {
      return { chips: [], legend: _legend };
    },
  };
}
