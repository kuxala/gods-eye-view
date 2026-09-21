// The MilitarySpend fork is a public site: NonCommercial and personal-use-only
// sources named in upstream DATA_SOURCES.md must not be bundled or fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

test('no TeleGeography data or code ships', () => {
  // This file names the vendor; every other file under these roots must not.
  const hits = execSync(
    'grep -rli --exclude=licenceClean.test.mjs telegeography src server public build || true',
    { cwd: root },
  )
    .toString().trim();
  assert.equal(hits, '', `TeleGeography still referenced in:\n${hits}`);
  assert.equal(existsSync(new URL('src/layers/submarineCables/', root)), false);
});

test('regional news never calls Google News RSS', () => {
  const hits = execSync("grep -rn 'news.google' server src | grep -v '\\.test\\.' || true", { cwd: root })
    .toString().trim();
  assert.equal(hits, '', `Google News RSS still fetched in:\n${hits}`);
});

test('DATA_SOURCES.md documents the removals', () => {
  const doc = readFileSync(new URL('DATA_SOURCES.md', root), 'utf8');
  assert.doesNotMatch(doc, /\|\s*\*\*TeleGeography/);
  assert.doesNotMatch(doc, /\|\s*\*\*Google News RSS/);
  assert.match(doc, /MilitarySpend fork/);
});
