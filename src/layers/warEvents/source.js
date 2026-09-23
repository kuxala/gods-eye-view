const TIMELINE_URL = 'https://militaryspend.org/data/iran-war-timeline.json';

// 'Jul 12-13, 2026' | 'Jun 11–12, 2026' | 'Sep 1, 2026' -> epoch ms (UTC) of
// the first day. Anything else does not match and the row is skipped.
const DATE_RE = /^([A-Z][a-z]{2}) (\d{1,2})(?:\s*[-–]\s*\d{1,2})?, (\d{4})$/;
const MONTHS = Object.freeze({
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
});

/** Parse a timeline row's date string to the epoch ms of its first day (UTC). */
export function parseEventDate(dateText) {
  const match = DATE_RE.exec(String(dateText || ''));
  if (!match) return null;
  const [, monthName, day, year] = match;
  const month = MONTHS[monthName];
  if (month == null) return null;
  return Date.UTC(Number(year), month, Number(day));
}

/** Normalize a row's date for entry matching: en-dash -> ASCII hyphen, trimmed. */
export function normDate(dateText) {
  return String(dateText || '')
    .replace(/–/g, '-')
    .trim();
}

/** Normalize a title for prefix matching: lowercase, non-letters/digits to a single space. */
export function normTitle(titleText) {
  return String(titleText || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Validate the timeline JSON: an array of {date, title, description} strings. */
function normalizeTimelineSnapshot(payload) {
  if (!Array.isArray(payload)) return null;
  const rows = [];
  for (const row of payload) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.date !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.description !== 'string'
    )
      return null;
    rows.push({
      date: row.date,
      title: row.title,
      description: row.description,
    });
  }
  return rows;
}

/** Request and validate a complete Iran-war timeline snapshot before it replaces the last good one. */
export function createIranWarTimelineSource({
  url = TIMELINE_URL,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`Timeline HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeTimelineSnapshot(payload);
      if (!rows) throw new Error('Malformed timeline response');
      return rows;
    },
  };
}
