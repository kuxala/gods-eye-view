import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { filterTrailing24h, parseFirmsCsv } from '../../src/data/firmsCsv.js';

/**
 * NASA FIRMS live active-fire proxy with a memory + disk cache.
 * Upstream: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/2
 *
 * Merges three VIIRS NRT sources (NOAA-20, NOAA-21, Suomi-NPP — independent
 * satellites, no cross-source dedup) fetched sequentially with `days=2`
 * (`days=1` means "current UTC day", nearly empty just after 00:00Z) and
 * clamps to the trailing 24 h via src/data/firmsCsv.js. FIRMS quota is
 * 5,000 transactions / 10 min per MAP_KEY, so the cache is the point:
 * TTL 30 min, single-flight refresh, serve-stale-on-failure, and a
 * fresh-enough disk cache (.gev-cache/firms.json) prevents ANY upstream
 * fetch across dev-server restarts. Pattern mirrors celestrakProxy.
 *
 * Routes:
 *   GET /api/firms            → {fetchedAt, stale, ttlMs, sources, count, fires}
 *   GET /api/firms/status     → {hasKey, lastFetch, count, stale, ttlMs, transactions}
 *   GET /api/firms/persistent → {fetchedAt, cellDeg, cells} (T4b flare mask, see below)
 *
 * Keyless (no FIRMS_MAP_KEY): /api/firms → 503 {error:'no_key'}; status →
 * {hasKey:false}; persistent → 503 {error:'no_key'}. Upstream is never
 * touched without a key.
 *
 * T4b persistent-flare mask: a SEPARATE once-per-24h regional fetch (fixed
 * Iran/Gulf/Levant/Yemen bbox, not world), used by the strike-candidates
 * layer to suppress permanent oil/gas flares (Rumaila/Basra, Kuwait, South
 * Pars/Asaluyeh, Ras Laffan) that would otherwise light up every night.
 * FIRMS area-CSV day_range is capped at 5 (confirmed via the live API docs
 * at firms.modaps.eosdis.nasa.gov/api/area/ — "DAY_RANGE: 1 .. 5"; the
 * brief's proposed 7 exceeds that, so this uses 5). Detections are binned to
 * 0.02° cells; a cell is "persistent" once it's been seen on >= 4 distinct
 * UTC days. Adds +1 transaction/day — negligible against the 5,000/10 min
 * quota. Disk-cached separately (.gev-cache/firms-persistent.json) so a
 * dev-server restart doesn't force a re-fetch.
 *
 * @returns {import('vite').Plugin}
 */
export function firmsProxy() {
  const TTL_MS = 30 * 60_000;
  const STATUS_TTL_MS = 5 * 60_000;
  const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'];
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'firms.json');

  // T4b persistent-flare mask.
  const PERSISTENT_TTL_MS = 24 * 60 * 60_000;
  const PERSISTENT_SOURCE = 'VIIRS_SNPP_NRT';
  const PERSISTENT_BBOX = '34,12,63.5,40'; // west,south,east,north
  const PERSISTENT_DAY_RANGE = 5; // FIRMS area-CSV DAY_RANGE max is 5, not 7.
  const PERSISTENT_CELL_DEG = 0.02;
  const PERSISTENT_MIN_DAYS = 4;
  const PERSISTENT_CACHE_PATH = path.join(CACHE_DIR, 'firms-persistent.json');

  /** @type {?{at: number, sources: Array<object>, fires: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at: number, sources: Array<object>, fires: Array<object>}>} single-flight refresh */
  let inflight = null;
  /** @type {?{at: number, transactions: ?{used: number, limit: number}}} mapkey_status cache */
  let statusCache = null;
  /** @type {?Promise<?{used: number, limit: number}>} */
  let statusInflight = null;

  /** @type {?{at: number, cellDeg: number, cells: Array<string>}} */
  let persistentMem = null;
  let persistentDiskChecked = false;
  /** @type {?Promise<?{at: number, cellDeg: number, cells: Array<string>}>} */
  let persistentInflight = null;

  const mapKey = () => String(process.env.FIRMS_MAP_KEY || '').trim();

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (
        Number.isFinite(parsed?.at) &&
        Array.isArray(parsed?.sources) &&
        Array.isArray(parsed?.fires)
      ) {
        mem = parsed;
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[firms-proxy] cache write failed:', err?.message || err);
    }
  }

  async function readPersistentDiskOnce() {
    if (persistentDiskChecked) return;
    persistentDiskChecked = true;
    try {
      const parsed = JSON.parse(
        await fsp.readFile(PERSISTENT_CACHE_PATH, 'utf8'),
      );
      if (
        Number.isFinite(parsed?.at) &&
        Number.isFinite(parsed?.cellDeg) &&
        Array.isArray(parsed?.cells)
      ) {
        persistentMem = parsed;
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writePersistentDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(PERSISTENT_CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(
        '[firms-proxy] persistent cache write failed:',
        err?.message || err,
      );
    }
  }

  /**
   * Bin a regional 5-day fetch into 0.02° cells, keyed by the count of
   * distinct UTC days each cell was seen on. A cell seen on
   * >= PERSISTENT_MIN_DAYS distinct days is a persistent flare, not a
   * one-off strike.
   */
  function binPersistentCells(records) {
    /** @type {Map<string, Set<string>>} cell key -> set of UTC dates seen */
    const daysByCell = new Map();
    for (const record of records) {
      const lat = Number(record?.lat);
      const lon = Number(record?.lon);
      const date = typeof record?.acqDate === 'string' ? record.acqDate : '';
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) continue;
      const cellLat =
        Math.floor(lat / PERSISTENT_CELL_DEG) * PERSISTENT_CELL_DEG;
      const cellLon =
        Math.floor(lon / PERSISTENT_CELL_DEG) * PERSISTENT_CELL_DEG;
      const key = `${cellLat.toFixed(2)}_${cellLon.toFixed(2)}`;
      let days = daysByCell.get(key);
      if (!days) {
        days = new Set();
        daysByCell.set(key, days);
      }
      days.add(date);
    }
    const cells = [];
    for (const [key, days] of daysByCell) {
      if (days.size >= PERSISTENT_MIN_DAYS) cells.push(key);
    }
    return cells;
  }

  /** Single regional day_range=5 fetch, binned into persistent-flare cells. */
  async function refreshPersistentUpstream(key) {
    const records = await fetchSource(
      key,
      PERSISTENT_SOURCE,
      `${PERSISTENT_BBOX}/${PERSISTENT_DAY_RANGE}`,
    );
    return {
      at: Date.now(),
      cellDeg: PERSISTENT_CELL_DEG,
      cells: binPersistentCells(records),
    };
  }

  /**
   * Fetch + parse one FIRMS source. Throws on HTTP error or a non-CSV body
   * (FIRMS reports errors as HTML/plain text, never CSV). Never log the URL —
   * it embeds the MAP_KEY.
   */
  async function fetchSource(key, source, area = 'world/2') {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${area}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = parseFirmsCsv(await res.text());
    if (records === null) throw new Error('non-CSV upstream response');
    return records;
  }

  /**
   * Refresh all sources sequentially (quota courtesy — never in parallel).
   * Partial success (≥1 source ok) still produces a cacheable entry with the
   * failed sources marked ok:false; total failure throws so the caller can
   * serve stale.
   */
  async function refreshUpstream(key) {
    const now = Date.now();
    const sources = [];
    const fires = [];
    for (const source of SOURCES) {
      try {
        const records = filterTrailing24h(await fetchSource(key, source), now);
        // NOT fires.push(...records): spread passes each record as an argument,
        // and a world/2 VIIRS pull exceeds V8's argument limit (~125k) at
        // ~131k records — RangeError, and the whole source is silently dropped.
        for (const record of records) fires.push(record);
        sources.push({ source, count: records.length, ok: true });
      } catch (err) {
        console.warn(
          `[firms-proxy] ${source} fetch failed:`,
          err?.message || err,
        );
        sources.push({ source, count: 0, ok: false });
      }
    }
    if (!sources.some((s) => s.ok)) throw new Error('all FIRMS sources failed');
    return { at: now, sources, fires };
  }

  /**
   * Cache entry → response payload. Fires are RE-filtered to the trailing
   * 24 h at serve time so a stale cache never serves >24h-old detections.
   */
  function buildPayload(entry, stale) {
    const fires = filterTrailing24h(entry.fires, Date.now());
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      sources: entry.sources,
      count: fires.length,
      fires,
    };
  }

  /** mapkey_status transactions, cached 5 min, best-effort (null on failure). */
  function getTransactions(key) {
    const now = Date.now();
    if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
      return Promise.resolve(statusCache.transactions);
    }
    if (!statusInflight) {
      statusInflight = (async () => {
        try {
          const url = `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(key)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const used = Number(body?.current_transactions);
          const limit = Number(body?.transaction_limit);
          return Number.isFinite(used) && Number.isFinite(limit)
            ? { used, limit }
            : null;
        } catch (err) {
          console.warn(
            '[firms-proxy] mapkey status failed:',
            err?.message || err,
          );
          return null;
        }
      })()
        .then((transactions) => {
          statusCache = { at: Date.now(), transactions };
          return transactions;
        })
        .finally(() => {
          statusInflight = null;
        });
    }
    return statusInflight;
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/firms', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        const key = mapKey();
        await readDiskOnce();

        if (subPath === '/status') {
          if (!key) {
            sendJson(200, {
              hasKey: false,
              lastFetch: null,
              count: null,
              stale: false,
              ttlMs: TTL_MS,
              transactions: null,
            });
            return;
          }
          const transactions = await getTransactions(key);
          sendJson(200, {
            hasKey: true,
            lastFetch: mem ? mem.at : null,
            count: mem ? mem.fires.length : null,
            stale: mem ? Date.now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            transactions,
          });
          return;
        }

        if (subPath === '/persistent') {
          if (!key) {
            sendJson(503, { error: 'no_key' });
            return;
          }
          await readPersistentDiskOnce();
          const persistentEntry = persistentMem;
          if (
            persistentEntry &&
            Date.now() - persistentEntry.at < PERSISTENT_TTL_MS
          ) {
            sendJson(200, {
              fetchedAt: persistentEntry.at,
              cellDeg: persistentEntry.cellDeg,
              cells: persistentEntry.cells,
            });
            return;
          }
          if (!persistentInflight) {
            persistentInflight = refreshPersistentUpstream(key)
              .then(async (fresh) => {
                persistentMem = fresh;
                await writePersistentDisk(fresh);
                return fresh;
              })
              .catch((err) => {
                console.warn(
                  `[firms-proxy] persistent refresh failed (${err?.message || err}) — serving cache if any`,
                );
                return null;
              })
              .finally(() => {
                persistentInflight = null;
              });
          }
          const freshPersistent = await persistentInflight;
          const servedEntry = freshPersistent || persistentEntry;
          if (servedEntry) {
            sendJson(200, {
              fetchedAt: servedEntry.at,
              cellDeg: servedEntry.cellDeg,
              cells: servedEntry.cells,
            });
          } else {
            sendJson(502, {
              error: 'firms persistent fetch failed and no cache available',
            });
          }
          return;
        }

        if (!key) {
          sendJson(503, { error: 'no_key' });
          return;
        }

        const entry = mem;
        if (entry && Date.now() - entry.at < TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream(key)
            .then(async (fresh) => {
              mem = fresh;
              await writeDisk(fresh);
              return fresh;
            })
            .catch((err) => {
              console.warn(
                `[firms-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error: 'firms fetch failed and no cache available',
          });
        }
      } catch (err) {
        console.warn('[firms-proxy] error:', err?.message || err);
        sendJson(500, { error: 'firms proxy error' });
      }
    });
  };
  return {
    name: 'firms-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
