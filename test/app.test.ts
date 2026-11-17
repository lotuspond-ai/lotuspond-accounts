import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { hydraAdmin } from '../src/hydra.ts';

const up = { ping: async () => true };
const down = { ping: async () => false };
const ready = { ready: async () => true };

test('health is ok only when the directory, every cell and Hydra answer', async () => {
  const ok = await createApp({ directory: up, cells: new Map([['in', up]]), hydra: ready }).request('/api/health');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'ok', directory: true, cells: { in: true }, hydra: true });

  const cellDown = await createApp({ directory: up, cells: new Map([['in', down]]), hydra: ready }).request('/api/health');
  assert.equal(cellDown.status, 503);
  assert.deepEqual(await cellDown.json(), { status: 'unavailable', directory: true, cells: { in: false }, hydra: true });

  const hydraDown = await createApp({ directory: up, cells: new Map([['in', up]]), hydra: { ready: async () => false } }).request('/api/health');
  assert.equal(hydraDown.status, 503);
});

test('every response carries strict security headers and is never cached', async () => {
  const res = await createApp({ directory: up, cells: new Map(), hydra: ready }).request('/anything');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=63072000/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('Hydra counts as ready only on a 2xx, and a network error is not ready', async () => {
  assert.equal(await hydraAdmin('http://h', async () => new Response('{}', { status: 200 })).ready(), true);
  assert.equal(await hydraAdmin('http://h', async () => new Response('{}', { status: 503 })).ready(), false);
  assert.equal(await hydraAdmin('http://h', async () => { throw new Error('ECONNREFUSED'); }).ready(), false);
});
