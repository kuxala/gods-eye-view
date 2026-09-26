import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { showInfoCard, hideInfoCard } from '../../ui/msInfoCard.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { IRAN_WAR_EVENT_PLACES } from '../../data/iranWarEventPlaces.js';
import { parseEventDate, normDate, normTitle } from './source.js';

export { createIranWarTimelineSource, parseEventDate } from './source.js';

const LAYER_ID = 'iran-war-events';
const TIMELINE_LINK = {
  href: 'https://militaryspend.org/iran-war-timeline',
  label: 'Full timeline on MilitarySpend.org →',
};
const DAY_MS = 86_400_000;
const LATEST_WINDOW_MS = 72 * 60 * 60 * 1000;
const WINDOWS = Object.freeze({
  '7D': 7 * DAY_MS,
  '30D': 30 * DAY_MS,
  ALL: Infinity,
});

const KIND_COLORS = Object.freeze({
  'us-strike': '#ec1313',
  'israel-strike': '#b36bff',
  'iran-attack': '#ff7a2f',
  maritime: '#f2b84b',
  loss: '#f1e9e4',
  diplomacy: '#b08a78',
  unattributed: '#8f8f8f',
});
const KIND_LABELS = Object.freeze({
  'us-strike': 'US strike',
  'israel-strike': 'Israeli strike',
  // Hezbollah and Houthi attacks are tagged here too.
  'iran-attack': 'Iran / proxy attack',
  maritime: 'Maritime',
  loss: 'Loss',
  diplomacy: 'Diplomacy',
  unattributed: 'Unattributed',
});

function formatEventDate(epochMs) {
  return new Date(epochMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Cheap change check: row count plus the last row's date/title. */
function rowsChanged(previousRows, nextRows) {
  if (!Array.isArray(previousRows)) return true;
  if (previousRows.length !== nextRows.length) return true;
  const prevLast = previousRows[previousRows.length - 1];
  const nextLast = nextRows[nextRows.length - 1];
  return (
    prevLast?.date !== nextLast?.date || prevLast?.title !== nextLast?.title
  );
}

/** Build the placed-event index: one entity spec per (row, place) pair matched by date + title prefix. */
function buildPlacedEvents(rows) {
  const entries = [];
  let unplaced = 0;
  rows.forEach((row, rowIndex) => {
    const epochMs = parseEventDate(row.date);
    if (epochMs == null) return;
    const rowDate = normDate(row.date);
    const rowTitle = normTitle(row.title);
    const entry = IRAN_WAR_EVENT_PLACES.find(
      (candidate) =>
        normDate(candidate.date) === rowDate &&
        rowTitle.startsWith(normTitle(candidate.title)),
    );
    if (!entry) {
      unplaced++;
      return;
    }
    entry.places.forEach((place, placeIndex) => {
      entries.push({
        // rowIndex disambiguates two different timeline rows that resolve
        // to the same place entry (same date:normTitle match) — without it
        // their ids collide and Cesium's entities.add() throws forever.
        id: `iran-war-events:${rowDate}:${normTitle(entry.title)}:${placeIndex}:${rowIndex}`,
        epochMs,
        title: row.title,
        description: row.description,
        dateText: row.date,
        // A row can pin both sides' actions (e.g. a US strike and the Iranian
        // retaliation); a place-level kind overrides the entry's.
        kind: place.kind || entry.kind,
        place,
      });
    });
  });
  return { entries, unplaced };
}

/** Own the Iran-war event map display and its date scrubber. */
export function createIranWarEventsLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Iran war events require a snapshot source');

  let _viewer = null;
  let _dataSource = null;
  let _handler = null;
  let _loaded = false;
  let _loading = false;
  let _enabled = false;
  let _abort = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _entities = []; // [{ entity, event }]
  let _distinctDates = []; // sorted ascending, distinct epoch ms
  let _unplaced = 0;
  let _legend = [];
  let _lastRows = null; // most recent snapshot, for the cheap update() diff

  // Scrubber DOM + state.
  let _scrubberEl = null;
  let _rangeEl = null;
  let _labelEl = null;
  let _prevBtn = null;
  let _nextBtn = null;
  let _windowChips = new Map();
  let _scrubIndex = -1; // index into _distinctDates
  let _windowKey = 'ALL';

  function currentScrubDate() {
    return _scrubIndex >= 0 ? _distinctDates[_scrubIndex] : null;
  }

  function applyFilter() {
    const scrubDate = currentScrubDate();
    if (scrubDate == null) return;
    const windowMs = WINDOWS[_windowKey] ?? Infinity;
    const windowStart =
      windowMs === Infinity ? -Infinity : scrubDate - windowMs;
    for (const { entity, event } of _entities) {
      const visible =
        event.epochMs >= windowStart && event.epochMs <= scrubDate;
      entity.show = visible;
      if (!visible) continue;
      const isLatest = scrubDate - event.epochMs <= LATEST_WINDOW_MS;
      if (event.place.c === 'U') continue;
      entity.point.pixelSize = isLatest ? 12 : 8;
    }
  }

  function updateLabel() {
    if (!_labelEl) return;
    const scrubDate = currentScrubDate();
    if (scrubDate == null) {
      _labelEl.textContent = 'No events';
      return;
    }
    const windowMs = WINDOWS[_windowKey] ?? Infinity;
    const windowStart =
      windowMs === Infinity ? -Infinity : scrubDate - windowMs;
    const count = _entities.filter(
      ({ event }) => event.epochMs >= windowStart && event.epochMs <= scrubDate,
    ).length;
    _labelEl.textContent = `Through ${formatEventDate(scrubDate)} · ${count} events`;
  }

  function scrubTo(index, { requestRender = true } = {}) {
    if (!_distinctDates.length) return;
    _scrubIndex = Math.max(0, Math.min(_distinctDates.length - 1, index));
    if (_rangeEl) _rangeEl.value = String(_scrubIndex);
    applyFilter();
    updateLabel();
    if (_prevBtn) _prevBtn.disabled = _scrubIndex <= 0;
    if (_nextBtn) _nextBtn.disabled = _scrubIndex >= _distinctDates.length - 1;
    if (requestRender) governorRequestRender('iran-war-events:scrub');
  }

  function syncWindowChips() {
    for (const [key, button] of _windowChips) {
      button.classList.toggle('active', key === _windowKey);
      button.setAttribute(
        'aria-pressed',
        key === _windowKey ? 'true' : 'false',
      );
    }
  }

  function ensureScrubber() {
    if (_scrubberEl) return;
    _scrubberEl = document.createElement('div');
    _scrubberEl.id = 'ms-war-scrubber';

    _labelEl = document.createElement('div');
    _labelEl.className = 'ms-war-scrubber-label';
    _scrubberEl.appendChild(_labelEl);

    const controls = document.createElement('div');
    controls.className = 'ms-war-scrubber-controls';

    _prevBtn = document.createElement('button');
    _prevBtn.type = 'button';
    _prevBtn.className = 'ms-war-scrubber-step';
    _prevBtn.textContent = '◀';
    _prevBtn.setAttribute('aria-label', 'Previous event date');
    _prevBtn.addEventListener('click', () => scrubTo(_scrubIndex - 1));

    _rangeEl = document.createElement('input');
    _rangeEl.type = 'range';
    _rangeEl.className = 'ms-war-scrubber-range';
    _rangeEl.min = '0';
    _rangeEl.step = '1';
    _rangeEl.setAttribute('aria-label', 'Iran war timeline date');
    _rangeEl.addEventListener('input', () => scrubTo(Number(_rangeEl.value)));

    _nextBtn = document.createElement('button');
    _nextBtn.type = 'button';
    _nextBtn.className = 'ms-war-scrubber-step';
    _nextBtn.textContent = '▶';
    _nextBtn.setAttribute('aria-label', 'Next event date');
    _nextBtn.addEventListener('click', () => scrubTo(_scrubIndex + 1));

    controls.append(_prevBtn, _rangeEl, _nextBtn);
    _scrubberEl.appendChild(controls);

    const windowRow = document.createElement('div');
    windowRow.className = 'ms-war-scrubber-windows';
    _windowChips = new Map();
    for (const key of Object.keys(WINDOWS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ms-war-scrubber-window';
      button.textContent = key;
      button.setAttribute(
        'aria-label',
        `Show last ${key === 'ALL' ? 'all events' : key}`,
      );
      button.addEventListener('click', () => {
        _windowKey = key;
        syncWindowChips();
        applyFilter();
        updateLabel();
        governorRequestRender('iran-war-events:scrub');
      });
      _windowChips.set(key, button);
      windowRow.appendChild(button);
    }
    _scrubberEl.appendChild(windowRow);
    syncWindowChips();

    document.body.appendChild(_scrubberEl);
  }

  function removeScrubber() {
    if (_scrubberEl) _scrubberEl.remove();
    _scrubberEl = null;
    _rangeEl = null;
    _labelEl = null;
    _prevBtn = null;
    _nextBtn = null;
    _windowChips = new Map();
  }

  function showCardFor(event) {
    const approximate = event.place.c !== 'H' ? ' (approximate)' : '';
    showInfoCard({
      owner: LAYER_ID,
      title: event.title,
      rows: [
        ['Date', event.dateText],
        ['Place', `${event.place.name}${approximate}`],
        ['Type', KIND_LABELS[event.kind] || event.kind],
      ],
      note:
        event.description.length > 280
          ? `${event.description.slice(0, 280)}…`
          : event.description,
      link: TIMELINE_LINK,
    });
    governorRequestRender('iran-war-events:card');
  }

  function installInteraction(viewer) {
    if (_handler) return;
    _handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _handler.setInputAction((click) => {
      if (!isPointerFree()) return;
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const record = picked?.id?.id
        ? _entities.find(({ entity }) => entity.id === picked.id.id)
        : null;
      if (record) {
        showCardFor(record.event);
      } else {
        hideInfoCard(LAYER_ID);
        governorRequestRender('iran-war-events:card');
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /** Spiral-jitter stacked places at the same rounded coordinate so a Hormuz pile stays clickable. */
  function jitteredPosition(lat, lon, stackIndex) {
    if (stackIndex === 0) return Cesium.Cartesian3.fromDegrees(lon, lat);
    const angle = stackIndex * 2.4;
    const radius = 0.02 * stackIndex;
    return Cesium.Cartesian3.fromDegrees(
      lon + radius * Math.cos(angle),
      lat + radius * Math.sin(angle),
    );
  }

  function buildEntities(rows) {
    const { entries, unplaced } = buildPlacedEvents(rows);
    _unplaced = unplaced;

    const stackCounts = new Map();
    const nextEntities = [];
    const seenIds = new Set();
    const legendCounts = new Map(
      Object.keys(KIND_COLORS).map((kind) => [kind, 0]),
    );

    for (const event of entries) {
      // Belt-and-suspenders: buildPlacedEvents ids are already unique, but a
      // duplicate id reaching entities.add() throws forever, so skip rather
      // than trust the upstream guard alone.
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      const [lat, lon] = event.place.at;
      const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      const stackIndex = stackCounts.get(key) || 0;
      stackCounts.set(key, stackIndex + 1);
      legendCounts.set(event.kind, (legendCounts.get(event.kind) || 0) + 1);

      const color = Cesium.Color.fromCssColorString(
        KIND_COLORS[event.kind] || '#f1e9e4',
      );
      const isUncertain = event.place.c === 'U';
      const entity = new Cesium.Entity({
        id: event.id,
        position: jitteredPosition(lat, lon, stackIndex),
        point: {
          pixelSize: 8,
          color: isUncertain ? Cesium.Color.TRANSPARENT : color,
          outlineColor: color,
          outlineWidth: isUncertain ? 2 : 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      nextEntities.push(entity);
      _entities.push({ entity, event });
    }

    _dataSource.entities.removeAll();
    for (const entity of nextEntities) _dataSource.entities.add(entity);

    _legend = Object.entries(KIND_COLORS).map(([kind, color]) => ({
      label: KIND_LABELS[kind],
      color,
      count: legendCounts.get(kind) || 0,
    }));

    _distinctDates = [...new Set(entries.map((event) => event.epochMs))].sort(
      (a, b) => a - b,
    );
    if (_rangeEl) _rangeEl.max = String(Math.max(0, _distinctDates.length - 1));
  }

  return {
    id: LAYER_ID,
    name: 'Iran War Events',
    icon: '✦',
    source: 'MilitarySpend.org timeline',
    updateInterval: 1_800_000,

    init(viewer) {
      if (_viewer)
        throw new Error('Iran war events layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('iran-war-events');
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
      ensureScrubber();
      if (_distinctDates.length)
        scrubTo(_distinctDates.length - 1, { requestRender: false });
      // update() short-circuits once _loaded, so a re-enable after the first
      // load needs its own render request to show the entities again.
      if (_loaded) governorRequestRender('iran-war-events:enable');
    },

    disable() {
      _abort?.abort();
      _abort = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      hideInfoCard(LAYER_ID);
      removeScrubber();
      governorRequestRender('iran-war-events:disable');
    },

    async update() {
      // The timeline changes daily; re-fetch once the update interval has
      // elapsed instead of short-circuiting forever after the first load.
      if (!_enabled || _loading) return false;
      if (
        _loaded &&
        _lastUpdate !== null &&
        Date.now() - _lastUpdate < this.updateInterval
      )
        return false;
      _loading = true;
      const controller = new AbortController();
      _abort = controller;
      try {
        const rows = await source.getSnapshot({ signal: controller.signal });
        if (controller.signal.aborted || _abort !== controller) return false;
        const changed = !_loaded || rowsChanged(_lastRows, rows);
        _lastRows = rows;
        _lastUpdate = Date.now();
        _lastError = null;
        if (changed) {
          const previousScrubDate = currentScrubDate();
          _entities = [];
          buildEntities(rows);
          // Keep the scrubber on the same date when possible (a rebuild from
          // an unchanged-but-refetched payload shouldn't jump the user back
          // to "latest"); fall back to latest when that date is gone.
          const keepIndex =
            previousScrubDate == null
              ? -1
              : _distinctDates.indexOf(previousScrubDate);
          if (_scrubberEl && _distinctDates.length) {
            scrubTo(keepIndex >= 0 ? keepIndex : _distinctDates.length - 1, {
              requestRender: false,
            });
          }
          governorRequestRender('iran-war-events:update');
        }
        _loaded = true;
        return changed;
      } catch (error) {
        if (controller.signal.aborted || _abort !== controller) return false;
        console.warn('[Data:IranWarEvents] Fetch error:', error);
        _lastError = error?.message || 'Iran war timeline unavailable';
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
      removeScrubber();
      if (_handler) {
        _handler.destroy();
        _handler = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      _entities = [];
      _distinctDates = [];
      _lastRows = null;
      _loaded = false;
      _enabled = false;
    },

    getStats() {
      return {
        loading: _loading,
        error: _lastError,
        lastUpdate: _lastUpdate,
        count: _entities.length,
        unplaced: _unplaced,
      };
    },

    getRowControls() {
      return { chips: [], legend: _legend };
    },
  };
}
