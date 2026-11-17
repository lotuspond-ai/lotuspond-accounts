// Sign-in end to end, through Caddy and the real Ory Hydra, as a product would see it. Run by tools/e2e.sh against
// the local stack (deploy/docker-compose.local.yml), which registers the clients named in the environment.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Browser, csrfOf, hiddenValue, linkIn } from '../test/support/browser.ts';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const CLIENT = process.env.E2E_CLIENT_ID!;
const OUTSIDER = process.env.E2E_OUTSIDE_CLIENT_ID!;
const REDIRECT = 'http://localhost:9999/callback';
const AFTER_LOGOUT = 'http://localhost:9999/signed-out';
const PASSWORD = 'correct horse battery';

const browser = () => new Browser((url, init) => fetch(url, init), BASE);
const b64url = (b: Buffer) => b.toString('base64url');

interface Pkce { verifier: string; challenge: string }
const pkce = (): Pkce => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
};

function authorizeUrl(o: { client?: string; pkce?: Pkce | null; method?: string; prompt?: string; nonce?: string; scope?: string; extra?: Record<string, string> }): string {
  const q = new URLSearchParams({
    client_id: o.client ?? CLIENT, response_type: 'code', redirect_uri: REDIRECT,
    scope: o.scope ?? 'openid email', state: b64url(randomBytes(12)), nonce: o.nonce ?? b64url(randomBytes(12)),
  });
  if (o.pkce !== null) {
    const p = o.pkce ?? pkce();
    q.set('code_challenge', o.method === 'plain' ? p.verifier : p.challenge);
    q.set('code_challenge_method', o.method ?? 'S256');
  }
  if (o.prompt) q.set('prompt', o.prompt);
  for (const [k, v] of Object.entries(o.extra ?? {})) q.set(k, v);
  return `/oauth2/auth?${q}`;
}

/** Follow a flow until it leaves for the product's redirect URI, or stops on a page of ours. */
async function run(b: Browser, path: string): Promise<Response> {
  return b.follow(await b.get(path), 20);
}

const productAnswer = (res: Response): URLSearchParams => {
  const location = res.headers.get('location');
  assert.ok(location && location.startsWith(REDIRECT), `expected a return to the product, got ${res.status} ${location}`);
  return new URL(location).searchParams;
};

async function outbox(to: string): Promise<string> {
  const messages = (await (await fetch(`${BASE}/dev/outbox.json`)).json()) as { to: string; text: string }[];
  const m = messages.find(x => x.to === to);
  assert.ok(m, `no email to ${to}`);
  return m.text;
}

async function exchange(code: string, verifier: string, client = CLIENT): Promise<Response> {
  return fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client, code_verifier: verifier }),
  });
}

const claimsOf = (idToken: string): Record<string, unknown> => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));

/** Sign up through a product's sign-in, confirm the email, and return the browser at the product with a code. */
async function newAccount(email: string, p = pkce(), nonce = 'nonce-' + b64url(randomBytes(6))) {
  const b = browser();
  const login = await run(b, authorizeUrl({ pkce: p, nonce }));
  assert.equal(login.status, 200);
  const loginPage = await login.text();
  assert.match(loginPage, /Sign in\./);
  const challenge = hiddenValue(loginPage, 'login_challenge')!;
  const signupPage = await (await b.get(`/signup?login_challenge=${encodeURIComponent(challenge)}`)).text();
  const signedUp = await b.post('/signup', {
    csrf: csrfOf(signupPage), login_challenge: challenge, email, name: 'Asha Rao', password: PASSWORD, country: 'IN', accept_terms: 'yes',
  });
  const check = await signedUp.text();
  assert.match(check, /Confirm your email/);
  const link = new URL(linkIn(await outbox(email)));
  const confirm = await (await b.get(link.pathname + link.search)).text();
  assert.equal((await b.post('/verify-email', { csrf: csrfOf(confirm), token: link.searchParams.get('token')! })).status, 200);
  const done = await b.follow(await b.post('/login/continue', { csrf: csrfOf(check), login_challenge: challenge }), 20);
  return { b, done, p, nonce };
}

const unique = (name: string) => `${name}-${b64url(randomBytes(5)).toLowerCase()}@example.com`;

test('a product signs up a new person: PKCE code, then an ID token with the LotusPond claims', async () => {
  const email = unique('asha');
  const { done, p, nonce } = await newAccount(email);
  const answer = productAnswer(done);
  const code = answer.get('code');
  assert.ok(code, `no code: ${answer}`);
  const tokens = await exchange(code, p.verifier);
  assert.equal(tokens.status, 200);
  const { id_token } = (await tokens.json()) as { id_token: string };
  const claims = claimsOf(id_token);
  assert.equal(claims.iss, BASE);
  assert.deepEqual([claims.aud].flat(), [CLIENT]);
  assert.equal(claims.email, email);
  assert.equal(claims.email_verified, true);
  assert.equal(claims.region, 'in');
  assert.equal(claims.nonce, nonce);
  assert.deepEqual(claims.amr, ['pwd']);
  assert.equal(typeof claims.sid, 'string', 'a sid, for back-channel logout');
  assert.match(String(claims.sub), /^[0-9a-f-]{36}$/);
  assert.equal(claims.name, undefined, 'no name without the profile scope');
});

test('the same browser signs in again with prompt=none, with no page (single sign-on)', async () => {
  const { b } = await newAccount(unique('sso'));
  const p = pkce();
  const again = await run(b, authorizeUrl({ pkce: p, prompt: 'none' }));
  const code = productAnswer(again).get('code');
  assert.ok(code);
  assert.equal((await exchange(code, p.verifier)).status, 200);
});

test('a browser with no session gets login_required for prompt=none', async () => {
  const res = await run(browser(), authorizeUrl({ prompt: 'none' }));
  assert.equal(productAnswer(res).get('error'), 'login_required');
});

test('PKCE: the plain method and a missing challenge are refused; a wrong verifier gets no tokens', async () => {
  const { b } = await newAccount(unique('pkce'));
  const plain = productAnswer(await run(b, authorizeUrl({ method: 'plain' })));
  assert.equal(plain.get('code'), null, 'no code for plain PKCE');
  assert.ok(plain.get('error'), 'an error for plain PKCE');
  const none = productAnswer(await run(b, authorizeUrl({ pkce: null })));
  assert.equal(none.get('code'), null, 'no code without PKCE');
  assert.ok(none.get('error'));
  const p = pkce();
  const code = productAnswer(await run(b, authorizeUrl({ pkce: p }))).get('code')!;
  const wrong = await exchange(code, pkce().verifier);
  assert.equal(wrong.status, 400);
  assert.equal(((await wrong.json()) as { error: string }).error, 'invalid_grant');
});

test('an application that is not a LotusPond product is refused at consent', async () => {
  const { b } = await newAccount(unique('outsider'));
  const res = await run(b, authorizeUrl({ client: OUTSIDER }));
  const answer = productAnswer(res);
  assert.equal(answer.get('code'), null);
  assert.equal(answer.get('error'), 'access_denied');
});

test('signing out from a product asks, then ends the session; prompt=none then needs a sign-in', async () => {
  const { b, done, p } = await newAccount(unique('logout'));
  const { id_token } = (await (await exchange(productAnswer(done).get('code')!, p.verifier)).json()) as { id_token: string };
  // Hydra returns to post_logout_redirect_uri only with id_token_hint; without it, it refuses the request.
  const q = new URLSearchParams({ id_token_hint: id_token, post_logout_redirect_uri: AFTER_LOGOUT, state: 'bye' });
  const confirm = await run(b, `/oauth2/sessions/logout?${q}`);
  assert.equal(confirm.status, 200);
  const page = await confirm.text();
  assert.match(page, /Sign out of LotusPond\?/);
  const out = await b.follow(await b.post('/logout', { csrf: csrfOf(page), logout_challenge: hiddenValue(page, 'logout_challenge')!, action: 'sign_out' }), 20);
  assert.ok(out.headers.get('location')?.startsWith(AFTER_LOGOUT), `returned to ${out.headers.get('location')}`);
  assert.equal(productAnswer(await run(b, authorizeUrl({ prompt: 'none' }))).get('error'), 'login_required');
});

test('a password reset ends the Hydra session in every browser', async () => {
  const email = unique('reset');
  const { b } = await newAccount(email);
  const asker = browser();
  const form = await (await asker.get('/forgot-password')).text();
  await asker.post('/forgot-password', { csrf: csrfOf(form), email });
  let link: URL | undefined;
  for (let i = 0; i < 20 && !link; i++) {
    const text = await outbox(email);
    if (/reset-password/.test(text)) link = new URL(linkIn(text));
    else await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(link, 'no reset email');
  const resetPage = await (await asker.get(link.pathname + link.search)).text();
  assert.equal((await asker.post('/reset-password', { csrf: csrfOf(resetPage), token: link.searchParams.get('token')!, password: 'a brand new passphrase' })).status, 200);
  assert.equal(productAnswer(await run(b, authorizeUrl({ prompt: 'none' }))).get('error'), 'login_required');
});

test('Hydra refuses a return address after sign-out without the ID token as a hint', async () => {
  const q = new URLSearchParams({ client_id: CLIENT, post_logout_redirect_uri: AFTER_LOGOUT });
  const res = await browser().get(`/oauth2/sessions/logout?${q}`);
  assert.match(res.headers.get('location') ?? '', /\/error\?error=invalid_request/);
});

test('screen_hint=signup opens the sign-up page; Hydra refuses prompt=create, so products must not send it', async () => {
  const signup = await run(browser(), authorizeUrl({ extra: { screen_hint: 'signup' } }));
  assert.equal(signup.status, 200);
  assert.match(await signup.text(), /Create your LotusPond account\./);
});
