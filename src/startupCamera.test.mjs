import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('startup flight targets the Strait of Hormuz, not Austin', () => {
  const controls = readFileSync(new URL('./app/controls.js', import.meta.url), 'utf8');
  assert.match(controls, /flyToHormuz\(viewer\)/);
  assert.doesNotMatch(controls, /flyToAustin\(viewer\)/);
  assert.match(controls, /Strait of Hormuz/);
});

test('flyToHormuz is exported from camera.js with Hormuz coordinates', () => {
  const camera = readFileSync(new URL('./camera.js', import.meta.url), 'utf8');
  assert.match(camera, /export function flyToHormuz\(viewer\)/);
  // 56.27°E 26.57°N — the strait itself, between Oman and Iran.
  assert.match(camera, /fromDegrees\(56\.27, 26\.57,/);
});

test('index.html is branded and credits upstream', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>God's Eye View — MilitarySpend<\/title>/);
  assert.match(html, /God's Eye View by Bilawal Sidhu.*\(MIT\)/);
  assert.match(html, /id="ms-return"/);
});
