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

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const stylesDir = path.join(root, 'src/ui/styles');
const targetFiles = [
  path.join(root, 'style.css'),
  ...readdirSync(stylesDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => path.join(stylesDir, f)),
];

// Order matters: replace the more specific rgba() patterns before the bare
// hex codes so we don't accidentally touch a hex code embedded in a comment
// about an rgba (not applicable here, but keeps the map self-documenting).
const replacements = [
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
];

let totalReplacements = 0;

for (const filePath of targetFiles) {
  const original = readFileSync(filePath, 'utf8');
  let updated = original;
  let fileCount = 0;

  for (const { pattern, replacement } of replacements) {
    const matches = updated.match(pattern);
    if (matches) fileCount += matches.length;
    updated = updated.replace(pattern, replacement);
  }

  if (fileCount > 0) {
    writeFileSync(filePath, updated, 'utf8');
  }

  totalReplacements += fileCount;
  const relPath = path.relative(root, filePath);
  console.log(`${relPath}: ${fileCount} replacement${fileCount === 1 ? '' : 's'}`);
}

console.log(`\nTotal replacements: ${totalReplacements}`);
