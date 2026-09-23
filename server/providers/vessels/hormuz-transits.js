import path from 'node:path';
import fs, { promises as fsp } from 'node:fs';

/**
 * Hormuz 24h transit counter (T6).
 *
 * The browser only ever sees the newest VITE_AIS_LIVE_MAX_ROWS vessels
 * worldwide, and server vessel state is evicted AISSTREAM_STALE_MS after the
 * last report — neither can answer "how many vessels crossed the strait in
 * the last 24h". This module keeps its own small, bounded state instead:
 * per-MMSI last-zone-seen (<=48h) and a pruned 24h crossing log.
 *
 * Method: two-zone side-change. A straight gate-line segment test needs
 * consecutive fixes on both sides of the line, but AIS coverage in the strait
 * is patchy (terrestrial receivers), so this tracks which of two zones a
 * vessel was last seen in and records a crossing when it flips zones within
 * 48h. Zone boxes are deliberately approximate — see HORMUZ_ZONES — verify
 * on the globe and adjust if traffic lanes don't pass through both, or if a
 * zone swallows an anchorage (e.g. Fujairah/Khor Fakkan sits ~25.2-25.4N,
 * which is why EAST's south edge stays at 25.40).
 */

export const HORMUZ_WINDOW_MS = 24 * 60 * 60 * 1000;
const LAST_ZONE_TTL_MS = 48 * 60 * 60 * 1000;
const DISK_WRITE_DEBOUNCE_MS = 5 * 60 * 1000;

/** Approximate gate zones: [minLat, minLon, maxLat, maxLon]. Eyeball/adjust. */
export const HORMUZ_ZONES = Object.freeze({
  // Persian Gulf side: west of Musandam, south of Qeshm, off Ras al-Khaimah.
  west: Object.freeze([25.9, 55.55, 26.9, 56.2]),
  // Gulf of Oman side: east of Musandam, north of Fujairah. South edge held
  // at 25.40 so it doesn't cover the Fujairah/Khor Fakkan anchorage.
  east: Object.freeze([25.4, 56.55, 26.5, 57.4]),
});

/** Cheap worldwide-stream reject bounds (union of both zones, some margin). */
const OUTER_BOUNDS = Object.freeze({
  minLat: 25.4,
  maxLat: 26.9,
  minLon: 55.55,
  maxLon: 57.4,
});

/** @type {Map<string,{zone:'west'|'east', at:number}>} mmsi -> last zone seen */
const _lastZone = new Map();
/** @type {Array<{mmsi:string, at:number, direction:'inbound'|'outbound', typeAtCrossing:string}>} */
let _crossings = [];
/** Earliest timestamp this process has persisted/observed; drives partialWindow. */
let _trackingSince = null;

let _diskLoaded = false;
let _diskLoadPromise = null;
let _lastDiskWriteAt = 0;
let _diskWriteTimer = null;
let _dirty = false;

const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
const CACHE_PATH = path.join(CACHE_DIR, 'hormuz-transits.json');

function zoneForPosition(lat, lon) {
  const [w0, w1, w2, w3] = HORMUZ_ZONES.west;
  if (lat >= w0 && lat <= w2 && lon >= w1 && lon <= w3) return 'west';
  const [e0, e1, e2, e3] = HORMUZ_ZONES.east;
  if (lat >= e0 && lat <= e2 && lon >= e1 && lon <= e3) return 'east';
  return null;
}

/**
 * Observe one AIS position fix inside (or near) the strait. Cheap-rejects
 * anything outside the outer bounding box before any Map work, so the
 * worldwide stream costs ~nothing per message.
 *
 * @param {string} mmsi
 * @param {number} lat
 * @param {number} lon
 * @param {number} epochMs Fix time (AIS message epoch, not wall clock).
 * @param {string} type Vessel type captured at this instant ('tanker' | 'cargo' | 'other' | 'unknown' | '').
 */
export function observeHormuzPosition(mmsi, lat, lon, epochMs, type) {
  if (
    lat < OUTER_BOUNDS.minLat ||
    lat > OUTER_BOUNDS.maxLat ||
    lon < OUTER_BOUNDS.minLon ||
    lon > OUTER_BOUNDS.maxLon
  )
    return;
  const zone = zoneForPosition(lat, lon);
  if (!zone) return;
  if (!mmsi || !Number.isFinite(epochMs)) return;

  const previous = _lastZone.get(mmsi);
  if (
    previous &&
    previous.zone !== zone &&
    epochMs - previous.at <= LAST_ZONE_TTL_MS
  ) {
    _crossings.push({
      mmsi,
      at: Math.min(epochMs, Date.now()),
      direction: previous.zone === 'west' ? 'outbound' : 'inbound',
      typeAtCrossing: normalizedType(type),
    });
    _dirty = true;
    if (_trackingSince === null || epochMs < _trackingSince)
      _trackingSince = epochMs;
  }
  _lastZone.set(mmsi, { zone, at: epochMs });
  _dirty = true;
  if (_diskLoaded) scheduleDiskWrite();
}

/**
 * Classify the raw ITU-R M.1371 numeric AIS ship type (stored as a string by
 * vesselTypeFromAis in ais-store.js) into the counter's four buckets.
 * 70-79 = cargo, 80-89 = tanker (incl. hazardous 81-84), anything else =
 * other, missing/non-numeric = unknown.
 */
function normalizedType(type) {
  const numeric = Number(type);
  if (!Number.isFinite(numeric) || String(type ?? '').trim() === '')
    return 'unknown';
  if (numeric >= 70 && numeric <= 79) return 'cargo';
  if (numeric >= 80 && numeric <= 89) return 'tanker';
  return 'other';
}

/** Prunes crossings older than the 24h window and stale lastZone entries older than 48h. */
function prune(now) {
  const crossingCutoff = now - HORMUZ_WINDOW_MS;
  if (_crossings.length && _crossings[0].at < crossingCutoff) {
    _crossings = _crossings.filter((crossing) => crossing.at >= crossingCutoff);
  }
  const zoneCutoff = now - LAST_ZONE_TTL_MS;
  for (const [mmsi, entry] of _lastZone) {
    if (entry.at < zoneCutoff) _lastZone.delete(mmsi);
  }
}

/**
 * Summarize the trailing 24h window. `resolveType(mmsi, fallbackType)` lets
 * the caller reclassify a crossing whose static report arrived after it was
 * recorded (ais-store.js's `_aisStreamStatic`), falling back to the type
 * captured at crossing time when no static data is available.
 *
 * @param {number} now
 * @param {(mmsi:string, fallbackType:string) => string} [resolveType]
 */
export function hormuzTransitSummary(now, resolveType) {
  prune(now);
  const byType = { tanker: 0, cargo: 0, other: 0, unknown: 0 };
  let inbound = 0;
  let outbound = 0;
  for (const crossing of _crossings) {
    const type = normalizedType(
      typeof resolveType === 'function'
        ? resolveType(crossing.mmsi, crossing.typeAtCrossing)
        : crossing.typeAtCrossing,
    );
    byType[type]++;
    if (crossing.direction === 'inbound') inbound++;
    else outbound++;
  }
  const trackingSince = _trackingSince ?? now;
  return {
    windowHours: HORMUZ_WINDOW_MS / (60 * 60 * 1000),
    now,
    trackingSince,
    partialWindow: now - trackingSince < HORMUZ_WINDOW_MS,
    total: _crossings.length,
    inbound,
    outbound,
    byType,
    zones: {
      west: HORMUZ_ZONES.west,
      east: HORMUZ_ZONES.east,
    },
  };
}

/**
 * Load persisted state once (idempotent, safe to call repeatedly). MERGES
 * disk crossings into whatever this process has already observed since boot
 * (ingest starts at server setup, before any route calls this) rather than
 * replacing in-memory state wholesale — otherwise crossings seen between
 * process start and the first /hormuz request would be dropped. No save is
 * allowed before this resolves (see `_diskLoaded` guard in
 * observeHormuzPosition/scheduleDiskWrite), so a fast first-fix write can
 * never clobber the on-disk history with a near-empty snapshot.
 */
export async function loadHormuzState() {
  if (_diskLoaded) return;
  if (!_diskLoadPromise) {
    _diskLoadPromise = (async () => {
      try {
        const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
        const diskCrossings = Array.isArray(parsed?.crossings)
          ? parsed.crossings.filter(
              (crossing) =>
                crossing &&
                typeof crossing.mmsi === 'string' &&
                Number.isFinite(crossing.at) &&
                (crossing.direction === 'inbound' ||
                  crossing.direction === 'outbound'),
            )
          : [];
        if (diskCrossings.length) {
          const seen = new Set(
            _crossings.map((c) => `${c.mmsi}:${c.at}:${c.direction}`),
          );
          for (const crossing of diskCrossings) {
            const dedupeKey = `${crossing.mmsi}:${crossing.at}:${crossing.direction}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            _crossings.push(crossing);
          }
          _crossings.sort((a, b) => a.at - b.at);
        }
        if (Array.isArray(parsed?.lastZone)) {
          for (const [mmsi, entry] of parsed.lastZone) {
            if (
              typeof mmsi === 'string' &&
              entry &&
              (entry.zone === 'west' || entry.zone === 'east') &&
              Number.isFinite(entry.at) &&
              // In-memory (post-boot) observations win over stale disk state.
              !_lastZone.has(mmsi)
            )
              _lastZone.set(mmsi, entry);
          }
        }
        if (Number.isFinite(parsed?.trackingSince))
          _trackingSince =
            _trackingSince === null
              ? parsed.trackingSince
              : Math.min(_trackingSince, parsed.trackingSince);
        else if (_crossings.length && _trackingSince === null)
          _trackingSince = Math.min(..._crossings.map((c) => c.at));
      } catch {
        /* no disk cache yet */
      } finally {
        prune(Date.now());
        _diskLoaded = true;
      }
    })();
  }
  await _diskLoadPromise;
}

/** Persist current state to disk. Also called on SIGINT/SIGTERM flush. */
export async function saveHormuzState() {
  if (!_diskLoaded || !_dirty) return;
  _dirty = false;
  _lastDiskWriteAt = Date.now();
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    // Atomic write: a crash/restart mid-write must never leave a truncated
    // or half-written cache file behind for loadHormuzState() to choke on.
    const tmpPath = `${CACHE_PATH}.tmp-${process.pid}`;
    await fsp.writeFile(
      tmpPath,
      JSON.stringify({
        crossings: _crossings,
        lastZone: [..._lastZone.entries()],
        trackingSince: _trackingSince,
      }),
      'utf8',
    );
    await fsp.rename(tmpPath, CACHE_PATH);
  } catch (err) {
    console.warn('[hormuz-transits] cache write failed:', err?.message || err);
  }
}

/** Debounced write (<=1/5min), plus a beforeExit flush registered once. */
function scheduleDiskWrite() {
  const sinceLastWrite = Date.now() - _lastDiskWriteAt;
  if (sinceLastWrite >= DISK_WRITE_DEBOUNCE_MS) {
    saveHormuzState();
    return;
  }
  if (_diskWriteTimer) return;
  _diskWriteTimer = setTimeout(() => {
    _diskWriteTimer = null;
    saveHormuzState();
  }, DISK_WRITE_DEBOUNCE_MS - sinceLastWrite);
  _diskWriteTimer.unref?.();
}

let _exitFlushArmed = false;
/**
 * Flush on SIGINT/SIGTERM (pm2's stop/restart signals) — `beforeExit` never
 * fires when the process is killed by signal, only on a natural event-loop
 * drain. Uses a synchronous write so it can complete before the process
 * exits. `once` removes only this listener; other handlers (Vite's
 * closeServerAndExit, pinokio-start's graceful close) still run their own
 * shutdown. Only when nobody else listens is the signal re-raised, so the
 * default termination still happens.
 */
export function armHormuzBeforeExit() {
  if (_exitFlushArmed) return;
  _exitFlushArmed = true;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      flushHormuzStateSync();
      if (process.listenerCount(signal) === 0) {
        process.kill(process.pid, signal);
      }
    });
  }
}

/** Synchronous, best-effort, atomic flush used only by the signal handlers above. */
function flushHormuzStateSync() {
  if (!_diskLoaded || !_dirty) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmpPath = `${CACHE_PATH}.tmp-${process.pid}`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({
        crossings: _crossings,
        lastZone: [..._lastZone.entries()],
        trackingSince: _trackingSince,
      }),
      'utf8',
    );
    fs.renameSync(tmpPath, CACHE_PATH);
    _dirty = false;
  } catch (err) {
    console.warn('[hormuz-transits] signal flush failed:', err?.message || err);
  }
}
