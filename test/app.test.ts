import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { hydraAdmin } from '../src/hydra.ts';
import { buildStylesheet } from '../src/views/styles.ts';
import { harness } from './support/harness.ts';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
afterEach(async () => { await h?.close(); });

test('health is ok only when the directory, every cell and Hydra answer', async () => {
  h = await harness();
  const ok = await h.app.request('/api/health');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'ok', directory: true, cells: { in: true }, hydra: true });
  h.hydra.isReady = false;
  const down = await h.app.request('/api/health');
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { status: 'unavailable', directory: true, cells: { in: true }, hydra: false });
});

test('every page carries strict security headers and is never cached', async () => {
  h = await harness();
  for (const path of ['/login', '/signup', '/forgot-password', '/nowhere']) {
    const res = await h.app.request(path);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.doesNotMatch(csp, /unsafe-inline/, path);
    assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=63072000/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    // no-referrer would make browsers send `Origin: null` on our own form posts, which checkForm refuses.
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  }
});

test('pages have no inline styles or scripts, which the policy would block', async () => {
  h = await harness();
  for (const path of ['/login', '/signup', '/forgot-password', '/signed-out', '/error']) {
    const page = await (await h.app.request(path)).text();
    assert.doesNotMatch(page, /\sstyle=|<style|<script|\son[a-z]+=/i, path);
    if (['/login', '/signup', '/forgot-password'].includes(path)) assert.match(page, /<label for="f-/, path);
    // The page's own referrer policy overrides the header. no-referrer makes browsers post our forms with
    // `Origin: null`, which the form check refuses (found on staging, 18 November 2026).
    assert.match(page, /<meta name="referrer" content="same-origin">/, path);
    assert.doesNotMatch(page, /no-referrer/, path);
  }
});

test('forms label every field and the sign-up form offers every country, India chosen', async () => {
  h = await harness();
  const page = await (await h.app.request('/signup')).text();
  for (const id of ['f-email', 'f-name', 'f-password', 'f-country', 'f-terms']) assert.match(page, new RegExp(`for="${id}"`));
  assert.match(page, /<option value="IN" selected>India<\/option>/);
  assert.ok((page.match(/<option value="[A-Z]{2}"/g) ?? []).length > 240);
});

test('the stylesheet resolves every design token, in both themes, and the fonts are served from here', async () => {
  const css = buildStylesheet();
  assert.doesNotMatch(css, /\{[a-z]+-?\d*\}/, 'no unresolved {token} references');
  assert.match(css, /--field:#9CAF88/);
  assert.match(css, /prefers-color-scheme:dark\)\{:root\{[^}]*--field:#2B3B30/);
  h = await harness();
  const font = await h.app.request('/assets/fonts/platypi.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal((await h.app.request('/assets/fonts/../../package.json')).status, 404);
});

test('the development outbox exists only in development and tests', async () => {
  h = await harness();
  assert.equal((await h.app.request('/dev/outbox.json')).status, 200);
});

test('Hydra counts as ready only on a 2xx, and a network error is not ready', async () => {
  assert.equal(await hydraAdmin('http://h', async () => new Response('{}', { status: 200 })).ready(), true);
  assert.equal(await hydraAdmin('http://h', async () => new Response('{}', { status: 503 })).ready(), false);
  assert.equal(await hydraAdmin('http://h', async () => { throw new Error('ECONNREFUSED'); }).ready(), false);
});

test('Hydra admin calls encode the challenge and never pass Hydra\'s error text on', async () => {
  const seen: string[] = [];
  const hydra = hydraAdmin('http://h', async (url) => { seen.push(url); return new Response('{"error":"secret detail"}', { status: 404 }); });
  await assert.rejects(hydra.getLogin('a&b=c'), (e: Error) => !/secret detail/.test(e.message));
  assert.equal(seen[0], 'http://h/admin/oauth2/auth/requests/login?login_challenge=a%26b%3Dc');
});

test('a Hydra challenge with base64 padding is accepted; markup and empty values are not', async () => {
  const { isChallenge } = await import('../src/hydra.ts');
  assert.equal(isChallenge('Rox0vtLkzO-tDnDa18L6KEZ2rdiSgdoEuowb-6uq=='), true, 'Hydra v26 challenges can end in =');
  assert.equal(isChallenge('a'.repeat(1204)), true);
  assert.equal(isChallenge(''), false);
  assert.equal(isChallenge('"><script>'), false);
  assert.equal(isChallenge('a'.repeat(9000)), false);
});
