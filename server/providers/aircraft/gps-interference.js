import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  hexCenter,
  pointToCell,
  cellKey,
  parseCellKey,
} from '../../../src/layers/gpsInterference/hex.js';

/**
 * T7 — GPS-interference hex grid, gpsjam.org-style, computed from adsb.lol's
 * regional point API (`/v2/lat/{lat}/lon/{lon}/dist/250`), which — unlike
 * OpenSky state vectors or the normalised adsb.lol fallback in
 * src/data/adsbLolFallback.js — exposes each aircraft's raw ADS-B NACp
 * (navigation accuracy). See task-7-brief.md for the full method and the
 * feasibility finding that ruled out reusing the existing flight feeds.
 *
 * Method (heuristic, flagged as such in the UI):
 *   - Only `type === 'adsb_icao'`, `version >= 1`, `nac_p` present, and
 *     position NOT mlat/tisb-derived (mlat/tisb field arrays excluding 'lat').
 *   - bad = nac_p < 8 (EPU < 93 m, the usual ADS-B-mandate floor).
 *   - Dedupe per hex per 0.5° axial hex cell across the trailing 24h window:
 *     an aircraft counts once per cell, and counts as "bad" if it was EVER
 *     bad in that cell during the window (conservative).
 *   - percent_bad = 100 * (bad - 1) / (good + bad) — the -1 suppresses
 *     single-aircraft false positives (gpsjam.org's method).
 *
 * Polling: sequential, one anchor every ~90s (~7 req/10 min total across the
 * 7 anchors, a full sweep ~10.5 min) — the owner-approved rate. Starts
 * lazily on the first GET /api/gps-interference and stops after 30 min with
 * no client requests, so an unwatched VPS deployment doesn't keep hammering
 * adsb.lol. Backs off on 429/5xx the same way adsb-lol.js does: honour a
 * sane Retry-After, else a bounded default cooldown. Never logs the request
 * URL's identifying content beyond the anchor (no auth to leak — the API is
 * keyless — but the pattern is kept consistent with the other proxies).
 *
 * State: Map<cellKey, Map<hourBucket, {good:Set<hex>, bad:Set<hex>}>>,
 * pruned to the trailing 24h (hourly buckets, so old hours drop cleanly)
 * once per full sweep. Persisted to .gev-cache/gps-interference.json once
 * per sweep, loaded once at process start.
 *
 * adsb.lol data is ODbL 1.0; this derived grid is a derived database and
 * stays under the same share-alike terms (see DATA_SOURCES.md).
 */

const ANCHORS = Object.freeze([
  [35.7, 51.4], // Tehran
  [33.3, 44.4], // Baghdad
  [29.5, 48.0], // Kuwait/Basra
  [26.5, 53.0], // Gulf centre
  [26.5, 57.0], // Hormuz
  [32.0, 35.5], // Levant
  [15.5, 44.0], // Yemen
]);

const ANCHOR_INTERVAL_MS = 90_000;
const IDLE_STOP_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const CELL_DEG = 0.5;
const WINDOW_HOURS = 24;
const HOUR_MS = 60 * 60_000;
const NAC_P_BAD_THRESHOLD = 8;
const MIN_TOTAL_FOR_CELL = 3;
const USER_AGENT = 'militaryspend-globe/1.0 (+https://militaryspend.org)';

const RATE_LIMIT_COOLDOWN_MS = 30_000;
const SERVER_ERROR_COOLDOWN_MS = 15_000;
const COOLDOWN_MIN_MS = 5_000;
const COOLDOWN_MAX_MS = 120_000;

const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
const CACHE_PATH = path.join(CACHE_DIR, 'gps-interference.json');

function clampCooldown(ms) {
  return Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS, ms));
}

/** Cooldown (ms) an upstream failure earns, honouring Retry-After when sane. */
function cooldownFor(status, headers, now) {
  const raw = headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0)
      return clampCooldown(seconds * 1000);
    const at = Date.parse(raw);
    if (Number.isFinite(at) && at > now) return clampCooldown(at - now);
  }
  return status === 429 ? RATE_LIMIT_COOLDOWN_MS : SERVER_ERROR_COOLDOWN_MS;
}

function hourBucketFor(epochMs) {
  return Math.floor(epochMs / HOUR_MS);
}

export function gpsInterferenceProxy() {
  /** @type {Map<string, Map<number, {good:Set<string>, bad:Set<string>}>>} */
  let _cells = new Map();
  let _coverageSince = null;
  let _generatedAt = 0;

  let _diskLoaded = false;
  let _diskLoadPromise = null;

  let _polling = false;
  let _pollTimer = null;
  let _anchorIndex = 0;
  let _lastClientRequestAt = 0;
  let _cooldownUntil = 0;
  let _cooldownStatus = 0;

  function recordObservation(q, r, hex, bucket, bad) {
    const ck = cellKey(q, r);
    let byHour = _cells.get(ck);
    if (!byHour) {
      byHour = new Map();
      _cells.set(ck, byHour);
    }
    let entry = byHour.get(bucket);
    if (!entry) {
      entry = { good: new Set(), bad: new Set() };
      byHour.set(bucket, entry);
    }
    (bad ? entry.bad : entry.good).add(hex);
  }

  function pruneOld(now) {
    const minBucket = hourBucketFor(now - WINDOW_HOURS * HOUR_MS);
    for (const [ck, byHour] of _cells) {
      for (const bucket of byHour.keys()) {
        if (bucket < minBucket) byHour.delete(bucket);
      }
      if (byHour.size === 0) _cells.delete(ck);
    }
  }

  async function readDiskOnce() {
    if (_diskLoaded) return;
    if (!_diskLoadPromise) {
      _diskLoadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
          if (Number.isFinite(parsed?.generatedAt))
            _generatedAt = parsed.generatedAt;
          if (Number.isFinite(parsed?.coverageSince))
            _coverageSince = parsed.coverageSince;
          if (Array.isArray(parsed?.cells)) {
            for (const [ck, hours] of parsed.cells) {
              if (typeof ck !== 'string' || !Array.isArray(hours)) continue;
              const byHour = new Map();
              for (const [bucket, good, bad] of hours) {
                if (!Number.isFinite(bucket)) continue;
                byHour.set(bucket, {
                  good: new Set(Array.isArray(good) ? good : []),
                  bad: new Set(Array.isArray(bad) ? bad : []),
                });
              }
              _cells.set(ck, byHour);
            }
          }
          pruneOld(Date.now());
        } catch {
          /* no disk cache yet */
        } finally {
          _diskLoaded = true;
        }
      })();
    }
    await _diskLoadPromise;
  }

  async function writeDisk() {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      const cells = [];
      for (const [ck, byHour] of _cells) {
        const hours = [];
        for (const [bucket, entry] of byHour) {
          hours.push([bucket, [...entry.good], [...entry.bad]]);
        }
        cells.push([ck, hours]);
      }
      await fsp.writeFile(
        CACHE_PATH,
        JSON.stringify({
          generatedAt: _generatedAt,
          coverageSince: _coverageSince,
          cells,
        }),
        'utf8',
      );
    } catch (err) {
      console.warn(
        '[gps-interference] cache write failed:',
        err?.message || err,
      );
    }
  }

  async function pollOneAnchor([lat, lon]) {
    const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/250`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }
    const payload = await res.json();
    const aircraft = Array.isArray(payload?.ac) ? payload.ac : [];
    const now = Date.now();
    const bucket = hourBucketFor(now);
    for (const ac of aircraft) {
      if (ac?.type !== 'adsb_icao') continue;
      const version = Number(ac?.version);
      if (!Number.isFinite(version) || version < 1) continue;
      const nacP = Number(ac?.nac_p);
      if (!Number.isFinite(nacP)) continue;
      const hex = String(ac?.hex || '')
        .trim()
        .toLowerCase();
      const acLat = Number(ac?.lat);
      const acLon = Number(ac?.lon);
      if (!hex || !Number.isFinite(acLat) || !Number.isFinite(acLon)) continue;
      const mlat = Array.isArray(ac?.mlat) ? ac.mlat : [];
      const tisb = Array.isArray(ac?.tisb) ? ac.tisb : [];
      if (mlat.includes('lat') || tisb.includes('lat')) continue;
      const { q, r } = pointToCell(acLat, acLon, CELL_DEG);
      recordObservation(q, r, hex, bucket, nacP < NAC_P_BAD_THRESHOLD);
    }
    if (_coverageSince === null) _coverageSince = now;
    _generatedAt = now;
  }

  function scheduleNextPoll(delayMs) {
    clearTimeout(_pollTimer);
    _pollTimer = setTimeout(runPollCycle, delayMs);
    _pollTimer.unref?.();
  }

  async function runPollCycle() {
    if (Date.now() - _lastClientRequestAt > IDLE_STOP_MS) {
      _polling = false; // no client in 30 min — stop, next request restarts us
      return;
    }
    const now = Date.now();
    if (now < _cooldownUntil) {
      scheduleNextPoll(_cooldownUntil - now);
      return;
    }
    const anchor = ANCHORS[_anchorIndex];
    try {
      await pollOneAnchor(anchor);
      _cooldownUntil = 0;
      _cooldownStatus = 0;
    } catch (err) {
      if (err?.status === 429 || err?.status >= 500) {
        const failedAt = Date.now();
        _cooldownUntil =
          failedAt + cooldownFor(err.status, err.headers, failedAt);
        _cooldownStatus = err.status;
        console.warn(
          `[gps-interference] upstream ${err.status}; cooling down ${Math.round((_cooldownUntil - Date.now()) / 1000)}s`,
        );
      } else {
        console.warn('[gps-interference] poll error:', err?.message || err);
      }
    }
    _anchorIndex++;
    if (_anchorIndex >= ANCHORS.length) {
      _anchorIndex = 0;
      pruneOld(Date.now());
      await writeDisk();
    }
    scheduleNextPoll(ANCHOR_INTERVAL_MS);
  }

  function ensurePolling() {
    _lastClientRequestAt = Date.now();
    if (_polling) return;
    _polling = true;
    scheduleNextPoll(0);
  }

  function buildPayload() {
    const now = Date.now();
    const cells = [];
    for (const [ck, byHour] of _cells) {
      const goodHexes = new Set();
      const badHexes = new Set();
      for (const entry of byHour.values()) {
        for (const hex of entry.good) goodHexes.add(hex);
        for (const hex of entry.bad) badHexes.add(hex);
      }
      // An aircraft seen both good and bad across the window counts as bad
      // (conservative — a degraded fix anywhere in the window is a signal).
      for (const hex of badHexes) goodHexes.delete(hex);
      const good = goodHexes.size;
      const bad = badHexes.size;
      const total = good + bad;
      if (total < MIN_TOTAL_FOR_CELL) continue;
      const pctBad = bad > 0 ? Math.max(0, (100 * (bad - 1)) / total) : 0;
      const { q, r } = parseCellKey(ck);
      const [lon, lat] = hexCenter(q, r, CELL_DEG);
      cells.push({ q, r, lat, lon, good, bad, pctBad });
    }
    return {
      generatedAt: _generatedAt || now,
      windowHours: WINDOW_HOURS,
      coverageSince: _coverageSince || now,
      cellDeg: CELL_DEG,
      method: 'NACp<8 share per 0.5° hex, gpsjam-style (bad-1)/(total)',
      cells,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/gps-interference', async (req, res) => {
      try {
        await readDiskOnce();
        ensurePolling();
        const payload = buildPayload();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        });
        res.end(JSON.stringify(payload));
      } catch (err) {
        console.warn('[gps-interference] route error:', err?.message || err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'gps-interference proxy error' }));
      }
    });
  };

  return {
    name: 'gps-interference-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
