#!/usr/bin/env node
// Re-run after merging upstream; idempotent.
//
// Applies the MilitarySpend palette (warm dark backgrounds, red accent, warm
// HUD text) across the UI stylesheets by mechanically replacing the upstream
// SITREP cyan/dark-blue theme colours. Safe to re-run: once the
// upstream colours are gone, the regexes simply find nothing to replace.
//
// Semantic status/alert colours (error, warning, danger, etc.) are NOT part
// of this map and are left untouched by design.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const stylesDir = path.join(root, 'src/ui/styles');
const cssTargetFiles = [
  path.join(root, 'style.css'),
  ...readdirSync(stylesDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => path.join(stylesDir, f)),
];

// Order matters: replace the more specific rgba() patterns before the bare
// hex codes so we don't accidentally touch a hex code embedded in a comment
// about an rgba (not applicable here, but keeps the map self-documenting).
const cssReplacements = [
  { pattern: /#0a0a0f/gi, replacement: '#120a0a', label: '--bg-dark' },
  {
    pattern: /rgba\(\s*12,\s*12,\s*20,\s*0\.72\s*\)/gi,
    replacement: 'rgba(18, 10, 10, 0.72)',
    label: '--glass-bg',
  },
  { pattern: /#12121c/gi, replacement: '#1a0f0f', label: '--menu-bg' },
  { pattern: /#00d4ff/gi, replacement: '#ec1313', label: '--accent' },
  {
    pattern: /rgba\(\s*0,\s*212,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(236, 19, 19, $1)',
    label: 'accent tints/glows',
  },
  { pattern: /#22e6e6/gi, replacement: '#d7c9c1', label: 'HUD text warm off-white' },
  {
    pattern: /rgba\(\s*34,\s*230,\s*230,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(215, 201, 193, $1)',
    label: 'HUD text tints',
  },
  { pattern: /#d8ffff/gi, replacement: '#f1e9e4', label: 'brightest HUD text' },
  {
    pattern: /(?<![a-z-])cyan(?![a-z-])/gi,
    replacement: '#d7c9c1',
    label: 'bare cyan keyword',
  },
  { pattern: /#e8eaed/gi, replacement: '#f1e9e4', label: '--text-primary' },
  {
    pattern: /rgba\(\s*232,\s*234,\s*237,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(241, 233, 228, $1)',
    label: '--text-primary tints',
  },
  { pattern: /#00dcff/gi, replacement: '#d7c9c1', label: '--cockpit-accent' },
  {
    pattern: /rgba\(\s*244,\s*251,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(241, 233, 228, $1)',
    label: 'cockpit HUD text tints',
  },
  // Decimal-rgba duplicates of hex codes already in the generic sweep's
  // "known hits" list (task 1b) — same underlying colour, different syntax.
  // Caught explicitly because the minifier can round-trip these back into
  // an 8-digit #rrggbbaa hex that would otherwise slip past the dist grep
  // check (rgba(0,220,255,X) -> #00dcffXX, etc).
  {
    pattern: /rgba\(\s*0,\s*220,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(215, 201, 193, $1)',
    label: 'rgba(0, 220, 255, X) [#00dcff]',
  },
  {
    pattern: /rgba\(\s*143,\s*207,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(241, 233, 228, $1)',
    label: 'rgba(143, 207, 255, X) [#8fcfff]',
  },
  {
    pattern: /rgba\(\s*101,\s*247,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(241, 233, 228, $1)',
    label: 'rgba(101, 247, 255, X) [#65f7ff]',
  },
];

// Generic blue/cyan-dominant hex sweep for CSS files (task 1b). Anything the
// exact map above didn't already catch, but that still reads as blue/cyan by
// the luminance-matched formula, gets swapped for the closest warm tone.
// Semantic status colours (warn/error/danger/success/live/stale/amber) are
// left alone — flagged in the console output instead of silently skipped.
const SEMANTIC_KEYWORDS = /warn|error|danger|success|live|stale|amber|green/i;
const HEX6_RE = /#([0-9a-fA-F]{6})\b/g;

function luminanceTarget(r, g, b) {
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (L >= 0.75) return '#f1e9e4';
  if (L >= 0.5) return '#d7c9c1';
  return '#8f7f78';
}

function isBlueCyanDominant(r, g, b) {
  return b > r + 40 && g > r + 20;
}

function applyGenericHexSweep(text, relPath, skippedLog) {
  const lines = text.split('\n');
  let currentSelector = '';
  let pendingSelectorLines = [];
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (HEX6_RE.test(line)) {
      HEX6_RE.lastIndex = 0;
      let match;
      let newLine = '';
      let lastIndex = 0;
      while ((match = HEX6_RE.exec(line))) {
        const hex = match[1].toLowerCase();
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        newLine += line.slice(lastIndex, match.index);

        if (isBlueCyanDominant(r, g, b)) {
          const propertyPart = line.slice(0, match.index);
          const context = `${currentSelector} ${propertyPart}`;
          if (SEMANTIC_KEYWORDS.test(context)) {
            skippedLog.push(`${relPath}: skipped #${hex} (semantic context: "${context.trim()}")`);
            newLine += match[0];
          } else {
            newLine += luminanceTarget(r, g, b);
            count++;
          }
        } else {
          newLine += match[0];
        }
        lastIndex = match.index + match[0].length;
      }
      newLine += line.slice(lastIndex);
      line = newLine;
      lines[i] = line;
    }

    if (line.includes('{')) {
      currentSelector = (pendingSelectorLines.join(' ') + ' ' + line.slice(0, line.indexOf('{'))).trim();
      pendingSelectorLines = [];
    } else if (line.includes('}')) {
      pendingSelectorLines = [];
    } else if (!line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
      pendingSelectorLines.push(line);
    }
  }

  return { text: lines.join('\n'), count };
}

// --- JS + SVG map (task 1c) ---------------------------------------------

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

const srcDir = path.join(root, 'src');
const jsTargetFiles = listJsFiles(srcDir).filter(
  (f) => path.relative(root, f) !== path.join('src', 'voice', 'actionSchemas.js'),
);

const jsReplacements = [
  { pattern: /Cesium\.Color\.CYAN/g, replacement: "Cesium.Color.fromCssColorString('#ec1313')", label: 'Cesium.Color.CYAN' },
  { pattern: /(?<!Cesium\.)\bColor\.CYAN\b/g, replacement: "Color.fromCssColorString('#ec1313')", label: 'Color.CYAN' },
  { pattern: /#22e6e6/gi, replacement: '#d7c9c1', label: '#22e6e6' },
  { pattern: /#00d4ff/gi, replacement: '#ec1313', label: '#00d4ff' },
  { pattern: /#00ffff/gi, replacement: '#ec1313', label: '#00ffff' },
  {
    pattern: /rgba\(\s*34,\s*230,\s*230,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(215, 201, 193, $1)',
    label: 'rgba(34, 230, 230, X)',
  },
  {
    pattern: /rgba\(\s*0,\s*255,\s*255,\s*([0-9.]+)\s*\)/gi,
    replacement: 'rgba(236, 19, 19, $1)',
    label: 'rgba(0, 255, 255, X) [hud.js]',
  },
];

const svgFile = path.join(root, 'public/logo.svg');
const svgReplacements = [
  { pattern: /#00f6ff/gi, replacement: '#ec1313', label: '#00f6ff' },
  { pattern: /#48b\b/gi, replacement: '#8f7f78', label: '#48b' },
];


// --- Generic hue pass (task 20) ------------------------------------------
//
// The exact maps above only catch literals we knew about. Upstream also uses
// cyan/blue in forms they miss: odd rgba tints (rgba(54, 220, 255, .45)),
// space syntax (rgb(0 212 255 / 28%)), pale blue-whites (#dceeff), 3-digit
// hex, gradient stops. This pass parses every colour token, converts to HSL
// and re-hues anything in the cyan→blue band, keeping lightness + alpha and
// the original syntax family. Idempotent: the output hues (0° / 18°) are
// outside the band, so a second run finds nothing.

const HUE_MIN = 165;
const HUE_MAX = 265;
const HUE_MIN_SATURATION = 0.12;
const ACCENT_HUE = 0;
const ACCENT_MIN_SATURATION = 0.55;
// 0.62 (not 0.6) so the common upstream tint rgba(54, 220, 255) (l = 0.606) and
// #39d0ff (l = 0.612) become accent red rather than a muted warm grey.
const ACCENT_MAX_LIGHTNESS = 0.62;
const NEUTRAL_HUE = 18;
const NEUTRAL_MAX_SATURATION = 0.18;

// JS files whose colours are UI chrome (panels, cards, callouts, HUD) and are
// re-hued wholesale. Everything else under src/ is treated as a data layer:
// its colours encode categories (vessel type, orbit class, radio genre...) and
// are only re-hued when the key name says selection/highlight/accent/UI.
const JS_UI_FILES = [
  /^src\/ui\//,
  /^src\/hud\.js$/,
  /^src\/scenes\//,
  /^src\/annotations\//,
  /^src\/overlays\/worldOverlayTokens\.js$/,
  /^src\/layers\/cctv\/frames\.js$/, // "NO FEED" placeholder plate chrome
  /^src\/data\/bhoteKoshi/, // scene-pack callout/locator presentation
];
const JS_SELECTION_KEYWORDS = /select|highlight|accent|track|\bui\b|^ui[A-Z_]/i;
// Object keys that name a hue: re-hueing `cyan: '#39d0ff'` to red would lie.
const HUE_NAMED_KEYS = /^(cyan|blue|teal|navy|sky|indigo|violet|purple)$/i;
// Object blocks that are per-category palettes or semantic HUD style modes.
const SKIP_BLOCK_KEYS = /^(tiers|surveillance|thermal|retro)$/;

const HEX_TOKEN_RE = /#([0-9a-fA-F]{3,8})\b/g;
const RGB_TOKEN_RE =
  /\b(rgba?)\(([ \t]*)(\d{1,3})(\s*,?\s*)(\d{1,3})(\s*,?\s*)(\d{1,3})((?:\s*[,/]\s*[\d.]+%?)?\s*)\)/g;
const COLOR_TOKEN_RE = new RegExp(`${HEX_TOKEN_RE.source}|${RGB_TOKEN_RE.source}`, 'g');

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(hk + 1 / 3), channel(hk), channel(hk - 1 / 3)].map((v) => Math.round(v * 255));
}

/** Returns the warm replacement for an rgb triple, or null when it is not blue/cyan. */
function warmify(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < HUE_MIN_SATURATION || h < HUE_MIN || h > HUE_MAX) return null;
  if (s >= ACCENT_MIN_SATURATION && l <= ACCENT_MAX_LIGHTNESS) {
    return hslToRgb(ACCENT_HUE, s, l);
  }
  return hslToRgb(NEUTRAL_HUE, Math.min(s, NEUTRAL_MAX_SATURATION), l);
}

function parseHex(digits) {
  if (![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? digits.split('').map((c) => c + c).join('') : digits;
  return {
    rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)),
    alpha: full.length === 8 ? full.slice(6) : '',
  };
}

function formatHex([r, g, b], alpha, upper) {
  const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') + alpha;
  return `#${upper ? hex.toUpperCase() : hex}`;
}

/** Re-hue one colour token, preserving its syntax family. Returns null if untouched. */
function warmifyToken(token) {
  if (token[0] === '#') {
    const parsed = parseHex(token.slice(1));
    if (!parsed) return null;
    const warm = warmify(...parsed.rgb);
    if (!warm) return null;
    const upper = /[A-F]/.test(token) && !/[a-f]/.test(token);
    return formatHex(warm, parsed.alpha, upper);
  }
  const m = new RegExp(`^${RGB_TOKEN_RE.source}$`).exec(token);
  if (!m) return null;
  const [, fn, lead, r, sep1, g, sep2, b, rest] = m;
  const rgb = [r, g, b].map(Number);
  if (rgb.some((v) => v > 255)) return null;
  const warm = warmify(...rgb);
  if (!warm) return null;
  return `${fn}(${lead}${warm[0]}${sep1}${warm[1]}${sep2}${warm[2]}${rest})`;
}

/** The identifier that the token is assigned to on this line (`key: '#..'`, `KEY = '#..'`). */
function keyBefore(prefix) {
  const m = /([A-Za-z_$][\w$-]*)\s*[:=]\s*[^:=]*$/.exec(prefix);
  return m ? m[1] : '';
}

/**
 * Walks a file line by line, re-hueing blue/cyan tokens. Tracks the CSS
 * selector (for semantic exclusions) or, in JS, the enclosing object key
 * (for per-category / HUD-mode block skips).
 */
function applyHuePass(text, { relPath, kind, skippedLog }) {
  const lines = text.split('\n');
  const isUiJs = kind === 'js' && JS_UI_FILES.some((re) => re.test(relPath));
  let currentSelector = '';
  let pendingSelectorLines = [];
  let skipDepth = 0; // >0 while inside a SKIP_BLOCK_KEYS object literal
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Hex-looking id selectors (`#bad {`) must never be treated as colours.
    const selectorEnd = kind === 'css' ? line.indexOf('{') : -1;

    let inSkipBlock = false;
    if (kind === 'js') {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      const open = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line);
      if (skipDepth === 0 && open && SKIP_BLOCK_KEYS.test(open[1])) {
        inSkipBlock = true;
        skipDepth = opens - closes;
      } else if (skipDepth > 0) {
        inSkipBlock = true;
        skipDepth = Math.max(0, skipDepth + opens - closes);
      }
    }

    {
      lines[i] = line.replace(COLOR_TOKEN_RE, (token, ...args) => {
        const offset = args[args.length - 2];
        if (selectorEnd >= 0 && offset < selectorEnd) return token;
        const prefix = line.slice(0, offset);
        const warm = warmifyToken(token);
        if (!warm) return token;

        const context = kind === 'css' ? `${currentSelector} ${prefix}` : prefix;
        const key = keyBefore(prefix);
        let skipReason = '';
        if (SEMANTIC_KEYWORDS.test(context)) skipReason = 'semantic status colour';
        else if (kind === 'js' && inSkipBlock) skipReason = 'per-category / HUD-mode block';
        else if (kind === 'js' && HUE_NAMED_KEYS.test(key)) skipReason = `hue-named key "${key}"`;
        else if (kind === 'js' && !isUiJs) {
          // A bare literal argument (`fn(text, '#39d0ff')`) has no key; look at
          // the call on the previous line instead, ignoring comments.
          const previous = (lines[i - 1] || '').trim();
          const near = /^(\*|\/\/|\/\*)/.test(previous) ? prefix : `${previous} ${prefix}`;
          if (!JS_SELECTION_KEYWORDS.test(key) && !JS_SELECTION_KEYWORDS.test(near)) {
            skipReason = 'data-layer colour (encodes category)';
          }
        }

        if (skipReason) {
          skippedLog.push(`${relPath}:${i + 1}: kept ${token} (${skipReason})`);
          return token;
        }
        count++;
        return warm;
      });
    }

    if (kind === 'css') {
      if (line.includes('{')) {
        currentSelector = (pendingSelectorLines.join(' ') + ' ' + line.slice(0, line.indexOf('{'))).trim();
        pendingSelectorLines = [];
      } else if (line.includes('}')) {
        pendingSelectorLines = [];
      } else if (!line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
        pendingSelectorLines.push(line);
      }
    }
  }

  return { text: lines.join('\n'), count };
}

// --- run ------------------------------------------------------------------

let totalReplacements = 0;
const skippedLog = [];

console.log('== CSS files ==');
for (const filePath of cssTargetFiles) {
  const original = readFileSync(filePath, 'utf8');
  let updated = original;
  let fileCount = 0;

  for (const { pattern, replacement } of cssReplacements) {
    const matches = updated.match(pattern);
    if (matches) fileCount += matches.length;
    updated = updated.replace(pattern, replacement);
  }

  const relPath = path.relative(root, filePath);
  const sweep = applyGenericHexSweep(updated, relPath, skippedLog);
  updated = sweep.text;
  fileCount += sweep.count;

  const hue = applyHuePass(updated, { relPath, kind: 'css', skippedLog });
  updated = hue.text;
  fileCount += hue.count;

  if (fileCount > 0) {
    writeFileSync(filePath, updated, 'utf8');
  }

  totalReplacements += fileCount;
  console.log(`${relPath}: ${fileCount} replacement${fileCount === 1 ? '' : 's'}`);
}

console.log('\n== JS files ==');
for (const filePath of jsTargetFiles) {
  const original = readFileSync(filePath, 'utf8');
  let updated = original;
  let fileCount = 0;

  for (const { pattern, replacement } of jsReplacements) {
    const matches = updated.match(pattern);
    if (matches) fileCount += matches.length;
    updated = updated.replace(pattern, replacement);
  }

  const relPath = path.relative(root, filePath);
  const hue = applyHuePass(updated, { relPath, kind: 'js', skippedLog });
  updated = hue.text;
  fileCount += hue.count;

  if (fileCount > 0) {
    writeFileSync(filePath, updated, 'utf8');
    console.log(`${relPath}: ${fileCount} replacement${fileCount === 1 ? '' : 's'}`);
  }

  totalReplacements += fileCount;
}

console.log('\n== SVG ==');
{
  const original = readFileSync(svgFile, 'utf8');
  let updated = original;
  let fileCount = 0;

  for (const { pattern, replacement } of svgReplacements) {
    const matches = updated.match(pattern);
    if (matches) fileCount += matches.length;
    updated = updated.replace(pattern, replacement);
  }

  if (fileCount > 0) {
    writeFileSync(svgFile, updated, 'utf8');
  }

  totalReplacements += fileCount;
  console.log(`${path.relative(root, svgFile)}: ${fileCount} replacement${fileCount === 1 ? '' : 's'}`);
}

if (skippedLog.length > 0) {
  console.log('\n== Skipped (left untouched) ==');
  for (const line of skippedLog) console.log(line);
}

console.log(`\nTotal replacements: ${totalReplacements}`);
