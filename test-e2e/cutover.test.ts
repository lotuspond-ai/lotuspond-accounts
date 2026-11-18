// The switch-over rehearsal (build plan M7), with synthetic people only, in three phases run by
// tools/cutover-rehearsal.sh around Health's real accounts:export and accounts:link and Accounts' import:
//   before    Health as it is today, passwords only: three people register.
//   after     Health with ACCOUNTS_ISSUER set and passwords still on: an imported person signs in through Accounts
//             into their own Health account, another still uses their Health password, someone new signs up.
//   rollback  Health with ACCOUNTS_ISSUER unset again: what each kind of person can and cannot do. E registers with
//             Health now, after the export, so E is never imported.
//   passwords-off  Health with ACCOUNTS_ISSUER and PASSWORD_SIGN_IN=off (build plan M8): everyone signs in through
//             Accounts, including people who never moved (B) and people who were never imported (E).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { csrfOf, hiddenValue, linkIn } from '../test/support/browser.ts';

const ACCOUNTS = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const HEALTH = process.env.HEALTH_URL ?? 'http://localhost:8787';
const PHASE = process.env.CUTOVER_PHASE;
const FACTS = process.env.CUTOVER_FACTS!;

interface Person { email: string; password: string; healthId: string }
interface Facts { a: Person; b: Person; c: Person; d?: Person; e?: Person; aNewPassword?: string }

/** A browser across both sites; cookies per host name, as browsers keep them. */
class Browser {
  private jar = new Map<string, Map<string, string>>();
  async request(method: string, href: string, o: { form?: Record<string, string>; json?: unknown } = {}): Promise<Response> {
    const url = new URL(href);
    const jar = this.jar.get(url.hostname) ?? new Map<string, string>();
    const headers: Record<string, string> = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body: string | undefined;
    if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; headers.origin = url.origin; body = new URLSearchParams(o.form).toString(); }
    if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    if (url.origin === HEALTH) headers['sec-fetch-site'] = 'same-origin';
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some(a => /max-age=0\b/i.test(a.trim())) || !value) jar.delete(name); else jar.set(name, value);
    }
    this.jar.set(url.hostname, jar);
    return res;
  }
  get = (href: string) => this.request('GET', href);
  async follow(res: Response, from: string, stop: (u: URL) => boolean = () => false): Promise<{ res: Response; url: URL }> {
    let url = new URL(from);
    for (let i = 0; i < 25 && res.status >= 300 && res.status < 400; i++) {
      url = new URL(res.headers.get('location')!, url);
      if (stop(url)) return { res, url };
      res = await this.get(url.href);
    }
    return { res, url };
  }
}

const health = (b: Browser, method: string, path: string, json?: unknown) => b.request(method, `${HEALTH}${path}`, json === undefined ? {} : { json });
const me = async (b: Browser) => (await (await health(b, 'GET', '/api/auth/me')).json()) as { account: { id: string } } | null;
const register = { displayName: 'Rehearsal Person', country: 'IN', ageConfirmed: true, consents: { termsAndPrivacy: true, healthData: true, crossBorder: true, marketing: false } };
const healthSignIn = (b: Browser, p: { email: string; password: string }) => health(b, 'POST', '/api/auth/login', { email: p.email, password: p.password });
const atHealthPage = (u: URL) => u.origin === HEALTH && !u.pathname.startsWith('/api/');

async function outbox(to: string, kind: RegExp): Promise<URL> {
  for (let i = 0; i < 30; i++) {
    const m = ((await (await fetch(`${ACCOUNTS}/dev/outbox.json`)).json()) as { to: string; text: string }[]).find(x => x.to === to && kind.test(x.text));
    if (m) return new URL(linkIn(m.text));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`No email to ${to}.`);
}

test(`switch-over rehearsal: ${PHASE}`, { skip: PHASE === 'passwords-off' }, async () => {
  if (PHASE === 'before') {
    const person = async (tag: string): Promise<Person> => {
      const p = { email: `cutover-${tag}-${randomBytes(3).toString('hex')}@example.com`, password: `health password ${randomBytes(3).toString('hex')}`, healthId: '' };
      const b = new Browser();
      assert.equal((await health(b, 'POST', '/api/auth/register', { email: p.email, password: p.password, ...register })).status, 201);
      p.healthId = (await me(b))!.account.id;
      return p;
    };
    const facts: Facts = { a: await person('a'), b: await person('b'), c: await person('c') };
    fs.writeFileSync(FACTS, JSON.stringify(facts), { mode: 0o600 });
    return;
  }

  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8')) as Facts;

  if (PHASE === 'after') {
    // A: imported. Signs in at Accounts with the old Health password, confirms the email, lands in their own account.
    const a = new Browser();
    const start = `${HEALTH}/api/auth/accounts/start?intent=login`;
    const page = await (await a.follow(await a.get(start), start)).res.text();
    const challenge = hiddenValue(page, 'login_challenge')!;
    const check = await (await a.request('POST', `${ACCOUNTS}/login`, { form: { csrf: csrfOf(page), login_challenge: challenge, email: facts.a.email, password: facts.a.password } })).text();
    assert.match(check, /Confirm your email/, 'the import left the email unconfirmed');
    const link = await outbox(facts.a.email, /verify-email/);
    const confirm = await (await a.get(link.href)).text();
    await a.request('POST', `${ACCOUNTS}/verify-email`, { form: { csrf: csrfOf(confirm), token: link.searchParams.get('token')! } });
    const back = await a.follow(await a.request('POST', `${ACCOUNTS}/login/continue`, { form: { csrf: csrfOf(check), login_challenge: challenge } }), `${ACCOUNTS}/login/continue`, atHealthPage);
    assert.equal(back.url.origin, HEALTH);
    assert.equal((await me(a))?.account.id, facts.a.healthId, 'A is in their own Health account, linked by accounts:link');
    // While switched on, A's old Health password opens nothing (the owner's decision of 18 November 2026).
    const aPassword = await healthSignIn(new Browser(), facts.a);
    assert.equal(aPassword.status, 409, 'a moved person\'s Health password is refused while Accounts sign-in is on');

    // B: not moved yet. Their Health password still works while passwords are on.
    const b = new Browser();
    assert.equal((await healthSignIn(b, facts.b)).status, 200);
    assert.equal((await me(b))?.account.id, facts.b.healthId);

    // D: someone new signs up through Accounts and gets a new Health account.
    const d = new Browser();
    facts.d = { email: `cutover-d-${randomBytes(3).toString('hex')}@example.com`, password: `accounts password ${randomBytes(3).toString('hex')}`, healthId: '' };
    const signupStart = `${HEALTH}/api/auth/accounts/start?intent=signup`;
    const signup = await (await d.follow(await d.get(signupStart), signupStart)).res.text();
    const dChallenge = hiddenValue(signup, 'login_challenge')!;
    const dCheck = await (await d.request('POST', `${ACCOUNTS}/signup`, { form: { csrf: csrfOf(signup), login_challenge: dChallenge, email: facts.d.email, name: 'New Person', password: facts.d.password, country: 'IN', accept_terms: 'yes' } })).text();
    const dLink = await outbox(facts.d.email, /verify-email/);
    const dConfirm = await (await d.get(dLink.href)).text();
    await d.request('POST', `${ACCOUNTS}/verify-email`, { form: { csrf: csrfOf(dConfirm), token: dLink.searchParams.get('token')! } });
    await d.follow(await d.request('POST', `${ACCOUNTS}/login/continue`, { form: { csrf: csrfOf(dCheck), login_challenge: dChallenge } }), `${ACCOUNTS}/login/continue`, atHealthPage);
    assert.equal((await health(d, 'POST', '/api/auth/accounts/complete', register)).status, 201);
    facts.d.healthId = (await me(d))!.account.id;
    assert.ok(![facts.a, facts.b, facts.c].some(p => p.healthId === facts.d!.healthId), 'a new Health account');

    // A then changes their password at Accounts (a reset), which matters for the rollback below.
    const asker = new Browser();
    const forgot = await (await asker.get(`${ACCOUNTS}/forgot-password`)).text();
    await asker.request('POST', `${ACCOUNTS}/forgot-password`, { form: { csrf: csrfOf(forgot), email: facts.a.email } });
    const reset = await outbox(facts.a.email, /reset-password/);
    const resetPage = await (await asker.get(reset.href)).text();
    facts.aNewPassword = `new accounts password ${randomBytes(3).toString('hex')}`;
    assert.equal((await asker.request('POST', `${ACCOUNTS}/reset-password`, { form: { csrf: csrfOf(resetPage), token: reset.searchParams.get('token')!, password: facts.aNewPassword } })).status, 200);
    fs.writeFileSync(FACTS, JSON.stringify(facts), { mode: 0o600 });
    return;
  }

  assert.equal(PHASE, 'rollback');
  // Health with ACCOUNTS_ISSUER unset: password sign-in only, as before the switch-over.
  const c = new Browser();
  assert.equal((await healthSignIn(c, facts.c)).status, 200, 'C, never moved, is unaffected');
  assert.equal((await me(c))?.account.id, facts.c.healthId);
  const b = new Browser();
  assert.equal((await healthSignIn(b, facts.b)).status, 200, 'B still has their Health password');

  // A, linked and since reset at Accounts. Health keeps A's old hash for exactly this: refused while Accounts sign-in
  // is on, it signs in again after a rollback. The NEW Accounts password does not open Health.
  const aOld = new Browser();
  const oldWorks = (await healthSignIn(aOld, facts.a)).status === 200;
  const aNew = new Browser();
  const newWorks = (await healthSignIn(aNew, { email: facts.a.email, password: facts.aNewPassword! })).status === 200;
  assert.equal(oldWorks, true, 'rolled back, A\'s old Health password works again, although A changed it at Accounts');
  assert.equal(newWorks, false, 'rolled back, A\'s new Accounts password does not open Health');
  if (oldWorks) assert.equal((await me(aOld))?.account.id, facts.a.healthId);

  // D only ever had an Accounts password: with Accounts sign-in off, D cannot sign in to Health.
  const d = new Browser();
  assert.notEqual((await healthSignIn(d, facts.d!)).status, 200, 'rolled back, D cannot sign in: they have no Health password');

  if (PHASE === 'rollback') {
    // E joins Health while it is rolled back: after the export, so E is never imported into Accounts.
    const e = new Browser();
    facts.e = { email: `cutover-e-${randomBytes(3).toString('hex')}@example.com`, password: `health password ${randomBytes(3).toString('hex')}`, healthId: '' };
    assert.equal((await health(e, 'POST', '/api/auth/register', { email: facts.e.email, password: facts.e.password, ...register })).status, 201);
    facts.e.healthId = (await me(e))!.account.id;
    fs.writeFileSync(FACTS, JSON.stringify(facts), { mode: 0o600 });
  }
});

/** Through Health's sign-in button to Accounts' page; sign in (or sign up) there; back at Health. */
async function throughAccounts(b: Browser, p: { email: string; password: string }, o: { signUp?: boolean; expectConfirm?: boolean } = {}) {
  const start = `${HEALTH}/api/auth/accounts/start?intent=${o.signUp ? 'signup' : 'login'}`;
  const page = await (await b.follow(await b.get(start), start)).res.text();
  const challenge = hiddenValue(page, 'login_challenge')!;
  const res = o.signUp
    ? await b.request('POST', `${ACCOUNTS}/signup`, { form: { csrf: csrfOf(page), login_challenge: challenge, email: p.email, name: 'Rehearsal Person', password: p.password, country: 'IN', accept_terms: 'yes' } })
    : await b.request('POST', `${ACCOUNTS}/login`, { form: { csrf: csrfOf(page), login_challenge: challenge, email: p.email, password: p.password } });
  if (!o.expectConfirm) return b.follow(res, `${ACCOUNTS}/login`, atHealthPage);
  const check = await res.text();
  assert.match(check, /Confirm your email/);
  const link = await outbox(p.email, /verify-email/);
  const confirm = await (await b.get(link.href)).text();
  await b.request('POST', `${ACCOUNTS}/verify-email`, { form: { csrf: csrfOf(confirm), token: link.searchParams.get('token')! } });
  return b.follow(await b.request('POST', `${ACCOUNTS}/login/continue`, { form: { csrf: csrfOf(check), login_challenge: challenge } }), `${ACCOUNTS}/login/continue`, atHealthPage);
}

test('switch-over rehearsal: passwords off (M8)', { skip: PHASE !== 'passwords-off' }, async () => {
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8')) as Facts;
  // Health's own password routes are closed to everyone.
  const b = new Browser();
  const pw = await healthSignIn(b, facts.b);
  assert.equal(pw.status, 409, 'Health passwords are off');
  assert.equal(((await pw.json()) as { error: { code: string } }).error.code, 'use_accounts');
  assert.equal((await health(new Browser(), 'POST', '/api/auth/register', { email: 'late@example.com', password: 'a long password here', ...register })).status, 409);

  // B never moved: their imported Health password works at Accounts, they confirm the email, and land in their account.
  await throughAccounts(b, facts.b, { expectConfirm: true });
  assert.equal((await me(b))?.account.id, facts.b.healthId, 'B, imported but never moved, reaches their own account');

  // E was never imported: they sign up at Accounts with the same email, confirm it, and Health joins their account.
  const e = new Browser();
  await throughAccounts(e, { email: facts.e!.email, password: `new accounts password ${randomBytes(3).toString('hex')}` }, { signUp: true, expectConfirm: true });
  assert.equal((await me(e))?.account.id, facts.e!.healthId, 'E, never imported, is joined to their own account by verified email');

  // A, moved and reset, signs in with the new Accounts password.
  const a = new Browser();
  await throughAccounts(a, { email: facts.a.email, password: facts.aNewPassword! });
  assert.equal((await me(a))?.account.id, facts.a.healthId);
});
