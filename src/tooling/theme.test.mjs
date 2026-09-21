// The MilitarySpend theme: no upstream cyan survives in the UI stylesheets
// or the JS call sites, and the root tokens carry the site palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url);
const rootPath = path.dirname(new URL('.', root).pathname);
const cssFiles = [
  'style.css',
  ...readdirSync(new URL('src/ui/styles/', root))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `src/ui/styles/${f}`),
];
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') && !entry.name.endsWith('.test.mjs')) {
      out.push(full);
    }
  }
  return out;
}

test('root tokens use the MilitarySpend palette', () => {
  const css = read('src/ui/styles/foundation.css');
  assert.match(css, /--bg-dark:\s*#120a0a;/);
  assert.match(css, /--accent:\s*#ec1313;/);
  assert.match(css, /--menu-bg:\s*#1a0f0f;/);
});

test('no upstream cyan remains in UI stylesheets', () => {
  const cyan =
    /#00d4ff|#22e6e6|#d8ffff|#00dcff|#8fcfff|#65f7ff|rgba\(\s*0,\s*212,\s*255|rgba\(\s*34,\s*230,\s*230|rgba\(\s*244,\s*251,\s*255|(?<![a-z-])cyan(?![a-z-])/i;
  const offenders = cssFiles.filter((p) => cyan.test(read(p)));
  assert.deepEqual(offenders, []);
});

test('no upstream cyan remains in JS layer/annotation call sites', () => {
  const cyan = /Color\.CYAN|#22e6e6|#00ffff|'cyan'/;
  const excluded = path.join('src', 'voice', 'actionSchemas.js');
  const jsFiles = listJsFiles(path.join(rootPath, 'src'))
    .map((p) => path.relative(rootPath, p))
    .filter((p) => p !== excluded);
  const offenders = jsFiles.filter((p) => cyan.test(readFileSync(path.join(rootPath, p), 'utf8')));
  assert.deepEqual(offenders, []);
});
