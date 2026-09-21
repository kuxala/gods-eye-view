#!/usr/bin/env node
// Re-run after merging upstream; idempotent.
//
// Applies the MilitarySpend palette (warm dark backgrounds, red accent, warm
// HUD text) across the UI stylesheets by mechanically replacing the upstream
// God's Eye View cyan/dark-blue theme colours. Safe to re-run: once the
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
const SEMANTIC_KEYWORDS = /warn|error|danger|success|live|stale|amber/i;
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
  { pattern: /'cyan'/g, replacement: "'#ec1313'", label: "'cyan'" },
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

  if (fileCount > 0) {
    writeFileSync(filePath, updated, 'utf8');
    const relPath = path.relative(root, filePath);
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
  console.log('\n== Skipped (semantic colours, left untouched) ==');
  for (const line of skippedLog) console.log(line);
}

console.log(`\nTotal replacements: ${totalReplacements}`);
