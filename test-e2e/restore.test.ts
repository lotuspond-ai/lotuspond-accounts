// The restore drill (build plan M6), in two phases run by tools/restore-drill.sh. Before the backup, a person signs up
// through a product and the facts are written down; after the stack is destroyed and restored, the same person must
// sign in with the same password, be the same subject, and get a token signed with the same key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Browser, csrfOf, hiddenValue, linkIn } from '../test/support/browser.ts';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const PHASE = process.env.DRILL_PHASE;
const FACTS = process.env.DRILL_FACTS!;
const CLIENT = process.env.E2E_CLIENT_ID!;
const REDIRECT = 'http://localhost:9999/callback';

interface Facts { email: string; password: string; sub: string; kid: string; client: string }

async function signInForToken(b: Browser, o: { email: string; password: string; signUp?: boolean }): Promise<Record<string, unknown> & { header: { kid: string } }> {
  const verifier = randomBytes(32).toString('base64url');
  const q = new URLSearchParams({
    client_id: CLIENT, response_type: 'code', redirect_uri: REDIRECT, scope: 'openid email', state: 'drill-state-01', nonce: 'drill-nonce-01',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'login',
  });
  const page = await (await b.follow(await b.get(`/oauth2/auth?${q}`), 20)).text();
  const challenge = hiddenValue(page, 'login_challenge')!;
  let done: Response;
  if (o.signUp) {
    const form = await (await b.get(`/signup?login_challenge=${encodeURIComponent(challenge)}`)).text();
    const check = await (await b.post('/signup', { csrf: csrfOf(form), login_challenge: challenge, email: o.email, name: 'Drill Person', password: o.password, country: 'IN', accept_terms: 'yes' })).text();
    const messages = (await (await fetch(`${BASE}/dev/outbox.json`)).json()) as { to: string; text: string }[];
    const link = new URL(linkIn(messages.find(m => m.to === o.email)!.text));
    const confirm = await (await b.get(link.pathname + link.search)).text();
    await b.post('/verify-email', { csrf: csrfOf(confirm), token: link.searchParams.get('token')! });
    done = await b.follow(await b.post('/login/continue', { csrf: csrfOf(check), login_challenge: challenge }), 20);
  } else {
    done = await b.follow(await b.post('/login', { csrf: csrfOf(page), login_challenge: challenge, email: o.email, password: o.password }), 20);
  }
  const location = done.headers.get('location') ?? '';
  assert.ok(location.startsWith(REDIRECT), `expected a return to the product, got ${done.status} ${location}`);
  const code = new URL(location).searchParams.get('code')!;
  const tokens = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier }),
  });
  assert.equal(tokens.status, 200);
  const { id_token } = (await tokens.json()) as { id_token: string };
  const [h, p] = id_token.split('.');
  return { ...JSON.parse(Buffer.from(p, 'base64url').toString()), header: JSON.parse(Buffer.from(h, 'base64url').toString()) };
}

test(`restore drill, ${PHASE} the backup`, async () => {
  const b = new Browser((url, init) => fetch(url, init), BASE);
  if (PHASE === 'before') {
    const facts: Facts = { email: `drill-${randomBytes(4).toString('hex')}@example.com`, password: `drill passphrase ${randomBytes(4).toString('hex')}`, sub: '', kid: '', client: CLIENT };
    const claims = await signInForToken(b, { email: facts.email, password: facts.password, signUp: true });
    facts.sub = String(claims.sub);
    facts.kid = claims.header.kid;
    fs.writeFileSync(FACTS, JSON.stringify(facts), { mode: 0o600 });
    return;
  }
  assert.equal(PHASE, 'after');
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8')) as Facts;
  const jwks = (await (await fetch(`${BASE}/.well-known/jwks.json`)).json()) as { keys: { kid: string }[] };
  assert.ok(jwks.keys.some(k => k.kid === facts.kid), 'Hydra publishes the same signing key as before the loss');
  const claims = await signInForToken(b, { email: facts.email, password: facts.password });
  assert.equal(claims.sub, facts.sub, 'the same person, with the same subject');
  assert.equal(claims.header.kid, facts.kid, 'signed with the same key');
  assert.equal(claims.email, facts.email);
  assert.equal(claims.email_verified, true, 'the confirmed email stayed confirmed');
});
