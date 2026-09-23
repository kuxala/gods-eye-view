import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { buildGeodesicRing } from './geodesic.js';
import {
  MISSILE_SYSTEMS,
  RING_ORIGINS,
  DEFAULT_ORIGIN_IDS,
  DEFAULT_SYSTEM_IDS,
  US_REGIONAL_BASES,
  RANGE_NOTE,
  BASE_NOTE,
} from './data.js';

const LAYER_ID = 'missile-ranges';
const ORIGIN_POINT_COLOR = '#ec1313';
const BASE_FILL_COLOR = '#f1e9e4';
const BASE_OUTLINE_COLOR = '#ec1313';
const LABEL_TEXT_COLOR = '#f1e9e4';
const LABEL_BACKGROUND = 'rgba(18,10,10,0.7)';
const RING_ALTITUDE_M = 5000; // clears the Zagros; plain non-clamped polylines
const RING_LABEL_DISPLAY_CONDITION = Object.freeze([0, 12_000_000]);
const BASE_LABEL_DISPLAY_CONDITION = Object.freeze([0, 3_000_000]);
const ALL_ORIGIN_IDS = Object.freeze(RING_ORIGINS.map((origin) => origin.id));

function formatKm(km) {
  return `${km.toLocaleString('en-US')} km`;
}

/** Own the Iranian missile-range-ring + US-regional-bases display. Static, prebuilt once. */
export function createMissileRangesLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _enabled = false;
  let _built = false;
  let _lastUpdate = null;
  let _recordsByEntityId = new Map();
  let _ringEntities = []; // [{ entity, labelEntity, systemId, originId }]
  let _originEntities = []; // [{ entity, originId }]
  let _baseEntities = []; // [{ entity, labelEntity, baseId }]
  let _rowControlsListener = null;

  // Row-control state. Params only ever toggle `entity.show` — entities are
  // prebuilt once by update() on first call.
  let _systemIds = new Set(DEFAULT_SYSTEM_IDS);
  let _basesOn = true;
  let _originsMode = '2'; // '2' | 'all'

  function activeOriginIds() {
    return _originsMode === 'all' ? ALL_ORIGIN_IDS : DEFAULT_ORIGIN_IDS;
  }

  function notifyRowControls() {
    try {
      _rowControlsListener?.();
    } catch (error) {
      console.warn('[Data:MissileRanges] row-controls listener failed:', error);
    }
  }

  function applyVisibility() {
    const originIds = new Set(activeOriginIds());
    for (const { entity, labelEntity, systemId, originId } of _ringEntities) {
      const visible = _systemIds.has(systemId) && originIds.has(originId);
      entity.show = visible;
      labelEntity.show = visible;
    }
    for (const { entity, originId } of _originEntities) {
      entity.show = originIds.has(originId);
    }
    for (const { entity, labelEntity } of _baseEntities) {
      entity.show = _basesOn;
      labelEntity.show = _basesOn;
    }
  }

  function showRingCard(systemId, originId) {
    const system = MISSILE_SYSTEMS.find((entry) => entry.id === systemId);
    const origin = RING_ORIGINS.find((entry) => entry.id === originId);
    if (!system || !origin) return;
    showInfoCard({
      owner: LAYER_ID,
      title: `${system.name} · ${system.class}`,
      rows: [
        ['System', system.name],
        ['Class', system.class],
        ['Range', formatKm(system.rangeKm)],
        ['Origin (representative)', origin.name],
      ],
      note: RANGE_NOTE,
      link: { href: system.csisUrl, label: 'CSIS Missile Defense Project →' },
    });
    governorRequestRender('missile-ranges:card');
  }

  function showBaseCard(baseId) {
    const base = US_REGIONAL_BASES.find((entry) => entry.id === baseId);
    if (!base) return;
    showInfoCard({
      owner: LAYER_ID,
      title: base.name,
      rows: [
        ['Country', base.country],
        ['Position', `${base.at[0].toFixed(3)}, ${base.at[1].toFixed(3)}`],
      ],
      note: BASE_NOTE,
    });
    governorRequestRender('missile-ranges:card');
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
      if (record?.type === 'ring') {
        showRingCard(record.systemId, record.originId);
      } else if (record?.type === 'base') {
        showBaseCard(record.baseId);
      } else {
        hideInfoCard(LAYER_ID);
        governorRequestRender('missile-ranges:card');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function buildEntities() {
    const records = new Map();
    const ringEntities = [];
    const originEntities = [];
    const baseEntities = [];

    for (const system of MISSILE_SYSTEMS) {
      const color = Cesium.Color.fromCssColorString(system.color);
      const material = system.dashed
        ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 })
        : new Cesium.ColorMaterialProperty(color);
      for (const origin of RING_ORIGINS) {
        const { positions, southernmost } = buildGeodesicRing({
          lat: origin.at[0],
          lon: origin.at[1],
          radiusKm: system.rangeKm,
          heightM: RING_ALTITUDE_M,
        });
        const ringId = `missile-ranges:ring:${system.id}:${origin.id}`;
        const entity = _dataSource.entities.add({
          id: ringId,
          polyline: {
            positions,
            width: 2,
            arcType: Cesium.ArcType.NONE,
            material,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        const labelId = `missile-ranges:label:${system.id}:${origin.id}`;
        const labelEntity = _dataSource.entities.add({
          id: labelId,
          position: Cesium.Cartesian3.fromDegrees(
            southernmost[1],
            southernmost[0],
            RING_ALTITUDE_M,
          ),
          label: {
            text: `${system.name} · ${formatKm(system.rangeKm)}`,
            font: '11px monospace',
            fillColor: Cesium.Color.fromCssColorString(LABEL_TEXT_COLOR),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString(LABEL_BACKGROUND),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              ...RING_LABEL_DISPLAY_CONDITION,
            ),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        ringEntities.push({
          entity,
          labelEntity,
          systemId: system.id,
          originId: origin.id,
        });
        records.set(ringId, {
          type: 'ring',
          systemId: system.id,
          originId: origin.id,
        });
      }
    }

    for (const origin of RING_ORIGINS) {
      const entity = _dataSource.entities.add({
        id: `missile-ranges:origin:${origin.id}`,
        position: Cesium.Cartesian3.fromDegrees(origin.at[1], origin.at[0]),
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString(ORIGIN_POINT_COLOR),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      originEntities.push({ entity, originId: origin.id });
    }

    for (const base of US_REGIONAL_BASES) {
      const position = Cesium.Cartesian3.fromDegrees(base.at[1], base.at[0]);
      const baseEntityId = `missile-ranges:base:${base.id}`;
      const entity = _dataSource.entities.add({
        id: baseEntityId,
        position,
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString(BASE_FILL_COLOR),
          outlineColor: Cesium.Color.fromCssColorString(BASE_OUTLINE_COLOR),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      const labelEntity = _dataSource.entities.add({
        id: `missile-ranges:base-label:${base.id}`,
        position,
        label: {
          text: base.name,
          font: '11px monospace',
          fillColor: Cesium.Color.fromCssColorString(LABEL_TEXT_COLOR),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(LABEL_BACKGROUND),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            ...BASE_LABEL_DISPLAY_CONDITION,
          ),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
      baseEntities.push({ entity, labelEntity, baseId: base.id });
      records.set(baseEntityId, { type: 'base', baseId: base.id });
    }

    _ringEntities = ringEntities;
    _originEntities = originEntities;
    _baseEntities = baseEntities;
    _recordsByEntityId = records;
  }

  return {
    id: LAYER_ID,
    name: 'Missile Ranges & US Bases',
    icon: '◎',
    source: 'CSIS · static',

    init(viewer) {
      if (_viewer)
        throw new Error('Missile ranges layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('missile-ranges');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      installInteraction(viewer);
      _enabled = false;
      _built = false;
      _systemIds = new Set(DEFAULT_SYSTEM_IDS);
      _basesOn = true;
      _originsMode = '2';
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      // update() only builds on the FIRST call and returns false forever
      // after, so a re-enable needs its own render request.
      if (_built) governorRequestRender('missile-ranges:enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      governorRequestRender('missile-ranges:disable');
    },

    async update() {
      if (_built) return false;
      buildEntities();
      applyVisibility();
      _built = true;
      _lastUpdate = Date.now();
      return true;
    },

    /**
     * @param {{ systems?: string[], bases?: boolean, origins?: '2'|'all' }} params
     * @param {{ origin?: string }} [_context]
     * @returns {boolean}
     */
    setParams(params = {}, _context = {}) {
      if (Array.isArray(params.systems)) {
        _systemIds = new Set(params.systems);
      }
      if (typeof params.bases === 'boolean') {
        _basesOn = params.bases;
      }
      if (params.origins === '2' || params.origins === 'all') {
        _originsMode = params.origins;
      }
      if (_built) applyVisibility();
      governorRequestRender('missile-ranges:params');
      notifyRowControls();
      return true;
    },

    getRowControls() {
      const chips = MISSILE_SYSTEMS.map((system) => {
        const active = _systemIds.has(system.id);
        const nextSystems = active
          ? [..._systemIds].filter((id) => id !== system.id)
          : [..._systemIds, system.id];
        return {
          id: system.id,
          label: system.name.toUpperCase(),
          active,
          title: `${system.name} — ${system.class}, ${formatKm(system.rangeKm)}`,
          params: { systems: nextSystems },
        };
      });
      chips.push({
        id: 'bases',
        label: 'BASES',
        active: _basesOn,
        title: 'US regional bases',
        params: { bases: !_basesOn },
      });
      chips.push({
        id: 'origins',
        label: _originsMode === 'all' ? 'ORIGINS: ALL' : 'ORIGINS: 2 / ALL',
        active: _originsMode === 'all',
        title: 'Toggle between 2 representative origins and all 4',
        params: { origins: _originsMode === 'all' ? '2' : 'all' },
      });
      return { chips, legend: [] };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    destroy(viewer = _viewer) {
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
      _ringEntities = [];
      _originEntities = [];
      _baseEntities = [];
      _enabled = false;
      _built = false;
      _lastUpdate = null;
      _rowControlsListener = null;
    },

    getStats() {
      return {
        count:
          _ringEntities.length + _originEntities.length + _baseEntities.length,
        lastUpdate: _lastUpdate,
        error: null,
      };
    },
  };
}
