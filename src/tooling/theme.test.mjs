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
  const cyan = /Color\.CYAN|#22e6e6|#00ffff/;
  const excluded = path.join('src', 'voice', 'actionSchemas.js');
  const jsFiles = listJsFiles(path.join(rootPath, 'src'))
    .map((p) => path.relative(rootPath, p))
    .filter((p) => p !== excluded);
  const offenders = jsFiles.filter((p) => cyan.test(readFileSync(path.join(rootPath, p), 'utf8')));
  assert.deepEqual(offenders, []);
});

// Hue-based check: no colour token in the UI stylesheets may still sit in the
// cyan→blue band (hue 165°–265°, saturation ≥ 0.12), whatever its syntax
// (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba() comma or space form, gradients).
// Mirrors the warmify() pass in scripts/apply-militaryspend-theme.mjs.
const COLOR_TOKEN_RE =
  /#([0-9a-fA-F]{3,8})\b|\brgba?\(\s*(\d{1,3})\s*,?\s*(\d{1,3})\s*,?\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)/g;

function tokenToRgb(match) {
  if (match[1] !== undefined) {
    const digits = match[1];
    if (![3, 4, 6, 8].includes(digits.length)) return null;
    const full =
      digits.length <= 4
        ? digits
            .split('')
            .map((c) => c + c)
            .join('')
        : digits;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  return [match[2], match[3], match[4]].map(Number);
}

function hueSaturation([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return { h: 0, s: 0 };
  const d = max - min;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s };
}

function blueHuedTokens(css) {
  const out = [];
  for (const match of css.matchAll(COLOR_TOKEN_RE)) {
    const rgb = tokenToRgb(match);
    if (!rgb || rgb.some((v) => v > 255)) continue;
    const { h, s } = hueSaturation(rgb);
    if (s >= 0.12 && h >= 165 && h <= 265) out.push(match[0]);
  }
  return out;
}

test('no blue/cyan-hued colour tokens remain in UI stylesheets', () => {
  const offenders = cssFiles.flatMap((p) => blueHuedTokens(read(p)).map((t) => `${p}: ${t}`));
  assert.deepEqual(offenders, []);
});
