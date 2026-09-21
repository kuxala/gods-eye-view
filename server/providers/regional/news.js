import { fetchRegionalJson } from './http.js';
import { normalizeRegionalArticles } from '../../../src/data/regionalModel.js';

async function fetchRegionalNews(place) {
  const query = place?.locality || place?.region || place?.country;
  if (!query)
    return { status: 'unavailable', query: null, articles: [], source: null };
  const params = new URLSearchParams({
    query: `"${String(query).replace(/["\\]/g, ' ').trim()}"`,
    mode: 'artlist',
    format: 'json',
    maxrecords: '5',
    sort: 'datedesc',
    timespan: '48h',
  });
  try {
    const payload = await fetchRegionalJson(
      `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
      {
        headers: { 'User-Agent': 'GodsEyeView/0.1' },
        timeoutMs: 12_000,
      },
    );
    const articles = normalizeRegionalArticles(payload, 5);
    return {
      status: articles.length ? 'ready' : 'empty',
      query,
      articles,
      source: 'GDELT',
    };
  } catch {
    return { status: 'unavailable', query, articles: [], source: null };
  }
}

export { fetchRegionalNews };
