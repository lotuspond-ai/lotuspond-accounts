// The import rehearsal (build plan M4, with synthetic accounts only): tools/e2e.sh imports a synthetic Health export
// with the real accounts-cli in the app container, then this signs in as one of those people through Hydra.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Browser, csrfOf, hiddenValue, linkIn } from '../test/support/browser.ts';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const CLIENT = process.env.E2E_CLIENT_ID!;
const EMAIL = process.env.E2E_IMPORTED_EMAIL!;
const PASSWORD = process.env.E2E_IMPORTED_PASSWORD!;
const SUB = process.env.E2E_IMPORTED_SUB!;
const REDIRECT = 'http://localhost:9999/callback';

test('an imported Health account signs in with its old password, confirms its email, and gets its imported subject', async () => {
  assert.ok(EMAIL && PASSWORD && SUB, 'tools/e2e.sh sets the imported account');
  const b = new Browser((url, init) => fetch(url, init), BASE);
  const verifier = randomBytes(32).toString('base64url');
  const q = new URLSearchParams({
    client_id: CLIENT, response_type: 'code', redirect_uri: REDIRECT, scope: 'openid email', state: 'imported-state', nonce: 'imported-nonce',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  const login = await b.follow(await b.get(`/oauth2/auth?${q}`), 20);
  const page = await login.text();
  const challenge = hiddenValue(page, 'login_challenge')!;
  const signedIn = await b.post('/login', { csrf: csrfOf(page), login_challenge: challenge, email: EMAIL, password: PASSWORD });
  const check = await signedIn.text();
  assert.match(check, /Confirm your email/, 'imported accounts confirm their email first');

  const messages = (await (await fetch(`${BASE}/dev/outbox.json`)).json()) as { to: string; text: string }[];
  const link = new URL(linkIn(messages.find(m => m.to === EMAIL)!.text));
  const confirm = await (await b.get(link.pathname + link.search)).text();
  assert.equal((await b.post('/verify-email', { csrf: csrfOf(confirm), token: link.searchParams.get('token')! })).status, 200);
  const done = await b.follow(await b.post('/login/continue', { csrf: csrfOf(check), login_challenge: challenge }), 20);
  const code = new URL(done.headers.get('location')!).searchParams.get('code');
  assert.ok(code, 'the product gets a code');
  const tokens = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier }),
  });
  const { id_token } = (await tokens.json()) as { id_token: string };
  const claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.sub, SUB, 'the subject the import answered, which Health\'s accounts:link records');
  assert.equal(claims.email_verified, true);
});
