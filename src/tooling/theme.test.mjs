// The MilitarySpend theme: no upstream cyan survives in the UI stylesheets,
// and the root tokens carry the site palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const cssFiles = [
  'style.css',
  ...readdirSync(new URL('src/ui/styles/', root))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `src/ui/styles/${f}`),
];
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('root tokens use the MilitarySpend palette', () => {
  const css = read('src/ui/styles/foundation.css');
  assert.match(css, /--bg-dark:\s*#120a0a;/);
  assert.match(css, /--accent:\s*#ec1313;/);
  assert.match(css, /--menu-bg:\s*#1a0f0f;/);
});

test('no upstream cyan remains in UI stylesheets', () => {
  const cyan = /#00d4ff|#22e6e6|#d8ffff|rgba\(\s*0,\s*212,\s*255|rgba\(\s*34,\s*230,\s*230|(?<![a-z-])cyan(?![a-z-])/i;
  const offenders = cssFiles.filter((p) => cyan.test(read(p)));
  assert.deepEqual(offenders, []);
});
