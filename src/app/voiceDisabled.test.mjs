// The MilitarySpend fork ships no voice/OpenAI surface: no realtime proxy on
// the server, no voice module reachable from the app entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('server plugin list does not register the OpenAI realtime proxy', () => {
  const src = readFileSync(new URL('../../server/providers/local.js', import.meta.url), 'utf8');
  const listStart = src.indexOf('function localProviderPlugins()');
  const listEnd = src.indexOf('];', listStart);
  assert.doesNotMatch(src.slice(listStart, listEnd), /openAiRealtimeProxy\(\)/);
});

test('app tools do not import the voice runtime', () => {
  const src = readFileSync(new URL('./tools.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/voice\//);
});

test('.env.example carries no OPENAI_ keys', () => {
  const env = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(env, /^OPENAI_/m);
});
