import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserViteConfig } from '../../build/vite.js';

const EMBED_CSP = 'frame-ancestors https://militaryspend.org';

test('serve and preview both allow embedding from militaryspend.org only', () => {
  const cfg = createBrowserViteConfig({});
  assert.equal(cfg.server.headers['Content-Security-Policy'], EMBED_CSP);
  assert.equal(cfg.preview.headers['Content-Security-Policy'], EMBED_CSP);
  assert.equal(cfg.server.headers['X-Frame-Options'], undefined);
  assert.equal(cfg.preview.headers['X-Frame-Options'], undefined);
});

test('extra allowed hosts reach both serve and preview', () => {
  const cfg = createBrowserViteConfig({ allowedHosts: ['globe.militaryspend.org'] });
  assert.ok(cfg.server.allowedHosts.includes('globe.militaryspend.org'));
  assert.ok(cfg.server.allowedHosts.includes('localhost'));
  assert.deepEqual(cfg.preview.allowedHosts, cfg.server.allowedHosts);
});

test('preview mirrors host and port', () => {
  const cfg = createBrowserViteConfig({ host: '127.0.0.1', port: '4173' });
  assert.equal(cfg.preview.host, '127.0.0.1');
  assert.equal(cfg.preview.port, 4173);
});
