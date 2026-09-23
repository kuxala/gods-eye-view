#!/usr/bin/env node
// Regenerate public/ms/country-budgets.json + public/ms/countries-110m.geojson
// from the militaryspend.org site's country profiles + world-atlas topology.
//
// Usage: node scripts/sync-militaryspend-budgets.mjs <path-to-militaryspend-repo>
//
// Run manually; the output is committed (bundled snapshot, not fetched at
// runtime). Re-run whenever SIPRI figures or the profile set changes.

import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Profile country name -> world-atlas 110m `properties.name`.
const NAME_ALIASES = Object.freeze({
  'United States': 'United States of America',
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'Dominican Republic': 'Dominican Rep.',
});

// The 110m topology has no polygon for these; render as point markers.
const POINT_OVERRIDES = Object.freeze({
  bahrain: [50.55, 26.07],
  singapore: [103.82, 1.35],
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

function roundCoordinates(coordinates) {
  if (typeof coordinates[0] === 'number') {
    return [round2(coordinates[0]), round2(coordinates[1])];
  }
  return coordinates.map(roundCoordinates);
}

async function loadProfiles(siteRoot) {
  const dir = path.join(siteRoot, 'src/data/countryProfiles');
  const entries = await readdir(dir);
  const files = entries.filter(
    (name) => name.endsWith('.js') && name !== 'index.js' && name !== '_schema.js',
  );
  const profiles = [];
  for (const name of files) {
    const mod = await import(pathToFileURL(path.join(dir, name)).href);
    if (mod?.default) profiles.push(mod.default);
  }
  return profiles;
}

async function main() {
  const siteRoot = process.argv[2];
  if (!siteRoot) {
    console.error(
      'Usage: node scripts/sync-militaryspend-budgets.mjs <path-to-militaryspend-repo>',
    );
    process.exit(1);
  }
  const siteRootAbs = path.resolve(siteRoot);
  const require = createRequire(path.join(siteRootAbs, 'package.json'));
  const { feature } = require('topojson-client');

  const topology = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(siteRootAbs, 'public/world-countries-110m.json'),
      'utf8',
    ),
  );
  const countriesFC = feature(topology, topology.objects.countries);
  const byTopoName = new Map(
    countriesFC.features.map((f) => [f.properties.name, f]),
  );

  const profiles = await loadProfiles(siteRootAbs);

  const unmatched = [];
  const budgetCountries = [];
  const geoFeatures = [];

  for (const profile of profiles) {
    const { slug, country: name, code, rank, spend2026, pctGdp } = profile;
    if (!slug || !name || !code || !spend2026 || !pctGdp) {
      unmatched.push(`${slug || name}: missing required fields`);
      continue;
    }
    const point = POINT_OVERRIDES[slug];
    if (point) {
      budgetCountries.push({
        slug,
        name,
        code,
        rank,
        spendUsd: spend2026.value,
        spendAsOf: spend2026.asOf,
        spendIsEstimate: Boolean(spend2026.isEstimate),
        pctGdp: pctGdp.value,
        topoName: null,
        point,
      });
      continue;
    }
    const topoName = NAME_ALIASES[name] || name;
    const feature = byTopoName.get(topoName);
    if (!feature) {
      unmatched.push(`${slug} (${name} / ${topoName})`);
      continue;
    }
    budgetCountries.push({
      slug,
      name,
      code,
      rank,
      spendUsd: spend2026.value,
      spendAsOf: spend2026.asOf,
      spendIsEstimate: Boolean(spend2026.isEstimate),
      pctGdp: pctGdp.value,
      topoName,
      point: null,
    });
    geoFeatures.push({
      type: 'Feature',
      properties: { name: topoName, code },
      geometry: {
        type: feature.geometry.type,
        coordinates: roundCoordinates(feature.geometry.coordinates),
      },
    });
  }

  if (unmatched.length) {
    console.error(`Unmatched profiles (${unmatched.length}):`);
    for (const line of unmatched) console.error(`  - ${line}`);
    process.exit(1);
  }

  const outDir = path.join(REPO_ROOT, 'public/ms');
  await (await import('node:fs/promises')).mkdir(outDir, { recursive: true });

  const budgetsPayload = {
    generatedAt: new Date().toISOString(),
    vintage: 'SIPRI 2025 actuals via militaryspend.org country profiles',
    source: 'https://militaryspend.org/country-profiles',
    countries: budgetCountries,
  };
  await writeFile(
    path.join(outDir, 'country-budgets.json'),
    JSON.stringify(budgetsPayload),
  );

  const geoPayload = { type: 'FeatureCollection', features: geoFeatures };
  await writeFile(
    path.join(outDir, 'countries-110m.geojson'),
    JSON.stringify(geoPayload),
  );

  const pointCount = budgetCountries.filter((c) => c.point).length;
  console.log(
    `Wrote ${geoFeatures.length} polygons + ${pointCount} points (${budgetCountries.length} countries total).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
