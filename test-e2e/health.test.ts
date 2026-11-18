// LotusPond Health signing in with the real LotusPond Accounts and Ory Hydra (build plan M3). tools/health-e2e.sh starts
// a Health server from a lotuspond-health checkout, registered at Accounts as a confidential client, and runs this.
// Every step goes through Health's own endpoints, as Health's website and apps call them.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { csrfOf, hiddenValue, linkIn } from '../test/support/browser.ts';

const ACCOUNTS = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const HEALTH = process.env.HEALTH_URL ?? 'http://localhost:8787';
const PASSWORD = 'correct horse battery';

/**
 * A browser across both sites. Cookies are kept per host name, not per port, as browsers do; Health and Accounts set
 * cookies with different names, so sharing `localhost` does not mix them.
 */
class Browser {
  private jar = new Map<string, Map<string, string>>();

  private cookies(url: URL): string {
    return [...(this.jar.get(url.hostname) ?? new Map())].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private keep(url: URL, res: Response): void {
    const jar = this.jar.get(url.hostname) ?? new Map<string, string>();
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const gone = attrs.some(a => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (gone || !value) jar.delete(name); else jar.set(name, value);
    }
    this.jar.set(url.hostname, jar);
  }

  async request(method: string, href: string, o: { form?: Record<string, string>; json?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const url = new URL(href);
    const headers: Record<string, string> = { cookie: this.cookies(url), ...o.headers };
    let body: string | undefined;
    if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; headers.origin = url.origin; body = new URLSearchParams(o.form).toString(); }
    if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    // Health's write endpoints accept only same-origin requests, as its own pages make them.
    if (url.origin === HEALTH) headers['sec-fetch-site'] = 'same-origin';
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    this.keep(url, res);
    return res;
  }

  get = (href: string) => this.request('GET', href);

  /** Follow redirects across both sites until a page (not a redirect) or an address `stop` accepts. */
  async follow(res: Response, from: string, stop: (url: URL) => boolean = () => false): Promise<{ res: Response; url: URL }> {
    let url = new URL(from);
    for (let i = 0; i < 25; i++) {
      if (res.status < 300 || res.status >= 400) return { res, url };
      url = new URL(res.headers.get('location')!, url);
      if (stop(url)) return { res, url };
      res = await this.get(url.href);
    }
    throw new Error('Too many redirects.');
  }
}

const unique = (name: string) => `${name}-${randomBytes(5).toString('hex')}@example.com`;
const finish = { displayName: 'Asha Rao', country: 'IN', ageConfirmed: true, consents: { termsAndPrivacy: true, healthData: true, crossBorder: true, marketing: false } };

async function outbox(to: string, kind: RegExp): Promise<URL> {
  for (let i = 0; i < 30; i++) {
    const messages = (await (await fetch(`${ACCOUNTS}/dev/outbox.json`)).json()) as { to: string; text: string }[];
    const m = messages.find(x => x.to === to && kind.test(x.text));
    if (m) return new URL(linkIn(m.text));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`No email to ${to}.`);
}

async function me(b: Browser): Promise<{ account: { id: string; email: string; hasPassword?: boolean } } | null> {
  return (await b.get(`${HEALTH}/api/auth/me`)).json() as Promise<{ account: { id: string; email: string } } | null>;
}

/** From Health's "Create account" to the Accounts sign-up page, then the account confirmed and back at Health. */
async function signUpAtAccounts(b: Browser, email: string, intent: 'signup' | 'login' = 'signup', start = `${HEALTH}/api/auth/accounts/start?intent=${intent}`): Promise<URL> {
  const atAccounts = await b.follow(await b.get(start), start);
  assert.equal(atAccounts.res.status, 200, `stopped at ${atAccounts.url}`);
  let page = await atAccounts.res.text();
  let challenge = hiddenValue(page, 'login_challenge')!;
  if (intent === 'login') {
    page = await (await b.get(`${ACCOUNTS}/signup?login_challenge=${encodeURIComponent(challenge)}`)).text();
  } else {
    assert.match(page, /Create your LotusPond account\./, 'screen_hint=signup opened the sign-up page');
  }
  challenge = hiddenValue(page, 'login_challenge')!;
  const check = await (await b.request('POST', `${ACCOUNTS}/signup`, {
    form: { csrf: csrfOf(page), login_challenge: challenge, email, name: 'Asha Rao', password: PASSWORD, country: 'IN', accept_terms: 'yes' },
  })).text();
  assert.match(check, /Confirm your email/);
  const link = await outbox(email, /verify-email/);
  const confirm = await (await b.get(link.href)).text();
  assert.equal((await b.request('POST', `${ACCOUNTS}/verify-email`, { form: { csrf: csrfOf(confirm), token: link.searchParams.get('token')! } })).status, 200);
  const cont = await b.request('POST', `${ACCOUNTS}/login/continue`, { form: { csrf: csrfOf(check), login_challenge: challenge } });
  const back = await b.follow(cont, `${ACCOUNTS}/login/continue`, u => u.origin === HEALTH && !u.pathname.startsWith('/api/'));
  return back.url;
}

/** Sign in at Accounts' page with a password, from Health's sign-in button, and return where Health lands. */
async function signInAtAccounts(b: Browser, email: string, password = PASSWORD): Promise<URL> {
  const start = `${HEALTH}/api/auth/accounts/start?intent=login`;
  const at = await b.follow(await b.get(start), start, u => u.origin === HEALTH && !u.pathname.startsWith('/api/'));
  if (at.url.origin === HEALTH) return at.url;
  const page = await at.res.text();
  const res = await b.request('POST', `${ACCOUNTS}/login`, { form: { csrf: csrfOf(page), login_challenge: hiddenValue(page, 'login_challenge')!, email, password } });
  return (await b.follow(res, `${ACCOUNTS}/login`, u => u.origin === HEALTH && !u.pathname.startsWith('/api/'))).url;
}

test('Health\'s "Create account" opens Accounts\' sign-up; after confirming, Health finishes its own sign-up', async () => {
  const b = new Browser();
  const email = unique('health-new');
  const landed = await signUpAtAccounts(b, email);
  assert.equal(`${landed.pathname}${landed.search}`, '/signup?accounts=continue');
  assert.equal(await me(b), null, 'not signed in to Health until its own questions are answered');
  const done = await b.request('POST', `${HEALTH}/api/auth/accounts/complete`, { json: finish });
  assert.equal(done.status, 201);
  const session = await me(b);
  assert.equal(session?.account.email, email);
});

test('signing out of Health signs out of Accounts with the ID token as the hint, and comes back to Health', async () => {
  const b = new Browser();
  const email = unique('health-out');
  await signUpAtAccounts(b, email);
  assert.equal((await b.request('POST', `${HEALTH}/api/auth/accounts/complete`, { json: finish })).status, 201);

  const out = await b.request('POST', `${HEALTH}/api/auth/logout`);
  const { accountsSignOut } = (await out.json()) as { accountsSignOut: string };
  assert.equal(accountsSignOut, '/api/auth/accounts/sign-out');
  const toAccounts = await b.get(`${HEALTH}${accountsSignOut}`);
  const end = new URL(toAccounts.headers.get('location')!);
  assert.equal(end.origin, ACCOUNTS);
  assert.ok(end.searchParams.get('id_token_hint'), 'the session\'s ID token goes as the hint');
  assert.equal(end.searchParams.get('post_logout_redirect_uri'), `${HEALTH}/login`);
  const confirm = await b.follow(await b.get(end.href), end.href);
  const page = await confirm.res.text();
  assert.match(page, /LotusPond Health asked to sign you out/);
  const signedOut = await b.request('POST', `${ACCOUNTS}/logout`, { form: { csrf: csrfOf(page), logout_challenge: hiddenValue(page, 'logout_challenge')!, action: 'sign_out' } });
  const home = await b.follow(signedOut, `${ACCOUNTS}/logout`, u => u.origin === HEALTH);
  assert.equal(`${home.url.origin}${home.url.pathname}`, `${HEALTH}/login`, 'back at Health\'s sign-in page');
  assert.equal(await me(b), null);

  // Signed out at Accounts too: signing in to Health again asks for the password.
  const again = `${HEALTH}/api/auth/accounts/start?intent=login`;
  const atAccounts = await b.follow(await b.get(again), again);
  assert.match(await atAccounts.res.text(), /Sign in\./);
});

test('a returning person signs in to Health with their Accounts password; a second sign-in needs no page', async () => {
  const email = unique('health-back');
  const first = new Browser();
  await signUpAtAccounts(first, email);
  assert.equal((await first.request('POST', `${HEALTH}/api/auth/accounts/complete`, { json: finish })).status, 201);
  const id = (await me(first))!.account.id;

  const other = new Browser();
  const landed = await signInAtAccounts(other, email);
  assert.equal(landed.origin, HEALTH);
  assert.equal((await me(other))?.account.id, id, 'the same Health account');

  // Single sign-on: Health's silent check (an agent's consent page uses it) finds the Accounts session.
  await other.request('POST', `${HEALTH}/api/auth/logout`);
  const silent = `${HEALTH}/api/auth/accounts/start?intent=login&prompt=none`;
  const back = await other.follow(await other.get(silent), silent, u => u.origin === HEALTH && !u.pathname.startsWith('/api/'));
  assert.equal(back.url.origin, HEALTH);
  assert.equal((await me(other))?.account.id, id, 'signed in again with no page');
});

test('a silent check from a browser not signed in at Accounts lands on Health\'s sign-in page', async () => {
  const b = new Browser();
  const silent = `${HEALTH}/api/auth/accounts/start?intent=login&prompt=none`;
  const back = await b.follow(await b.get(silent), silent, u => u.origin === HEALTH && !u.pathname.startsWith('/api/'));
  assert.equal(`${back.url.origin}${back.url.pathname}`, `${HEALTH}/login`);
  assert.equal(await me(b), null);
});

test('a password reset at Accounts ends Health\'s sessions through back-channel logout', async () => {
  const b = new Browser();
  const email = unique('health-reset');
  await signUpAtAccounts(b, email);
  assert.equal((await b.request('POST', `${HEALTH}/api/auth/accounts/complete`, { json: finish })).status, 201);
  assert.ok(await me(b), 'signed in to Health');

  const asker = new Browser();
  const form = await (await asker.get(`${ACCOUNTS}/forgot-password`)).text();
  await asker.request('POST', `${ACCOUNTS}/forgot-password`, { form: { csrf: csrfOf(form), email } });
  const link = await outbox(email, /reset-password/);
  const page = await (await asker.get(link.href)).text();
  assert.equal((await asker.request('POST', `${ACCOUNTS}/reset-password`, { form: { csrf: csrfOf(page), token: link.searchParams.get('token')!, password: 'a brand new passphrase' } })).status, 200);

  // Hydra delivers the logout token to Health server to server; give it a moment.
  let session = await me(b);
  for (let i = 0; i < 30 && session; i++) { await new Promise(r => setTimeout(r, 200)); session = await me(b); }
  assert.equal(session, null, 'Health\'s session ended without the browser doing anything');
});

test('an existing Health password account is joined on its first Accounts sign-in, once the email is confirmed', async () => {
  const email = unique('health-old');
  const b = new Browser();
  const registered = await b.request('POST', `${HEALTH}/api/auth/register`, { json: { email, password: 'an old health password', ...finish } });
  assert.equal(registered.status, 201, `a Health account with its own password (got ${registered.status}: ${(await registered.clone().text()).slice(0, 200)})`);
  const id = (await me(b))!.account.id;
  await b.request('POST', `${HEALTH}/api/auth/logout`);

  const fresh = new Browser();
  const landed = await signUpAtAccounts(fresh, email, 'login');
  assert.equal(landed.origin, HEALTH);
  assert.equal((await me(fresh))?.account.id, id, 'the same Health account, now signed in with Accounts');
});

test('the app signs in through the system browser and trades its one-time code for a Health token', async () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const sys = new Browser();
  const email = unique('health-app');
  const start = `${HEALTH}/api/auth/accounts/start?intent=signup&client=app&code_challenge=${challenge}`;
  const atAccounts = await sys.follow(await sys.get(start), start);
  const page = await atAccounts.res.text();
  const loginChallenge = hiddenValue(page, 'login_challenge')!;
  const check = await (await sys.request('POST', `${ACCOUNTS}/signup`, {
    form: { csrf: csrfOf(page), login_challenge: loginChallenge, email, name: 'Asha Rao', password: PASSWORD, country: 'IN', accept_terms: 'yes' },
  })).text();
  const link = await outbox(email, /verify-email/);
  const confirm = await (await sys.get(link.href)).text();
  await sys.request('POST', `${ACCOUNTS}/verify-email`, { form: { csrf: csrfOf(confirm), token: link.searchParams.get('token')! } });
  const handOff = await sys.follow(await sys.request('POST', `${ACCOUNTS}/login/continue`, { form: { csrf: csrfOf(check), login_challenge: loginChallenge } }), `${ACCOUNTS}/login/continue`);
  const returnPage = await handOff.res.text();
  const code = /[?&]code=([\w-]+)/.exec(returnPage.replace(/&amp;/g, '&'))?.[1];
  assert.ok(code, `Health handed a code back to the app (stopped at ${handOff.url})`);

  const app = (path: string, body: unknown, token?: string) => fetch(`${HEALTH}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lotuspond-client': 'app', origin: 'capacitor://localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const exchanged = await app('/api/auth/accounts/app-exchange', { code, verifier });
  assert.equal(exchanged.status, 200);
  const { pendingToken } = (await exchanged.json()) as { pendingToken: string };
  const done = await app('/api/auth/accounts/complete', { ...finish, pendingToken });
  assert.equal(done.status, 201);
  const { token } = (await done.json()) as { token: string };
  const who = await fetch(`${HEALTH}/api/auth/me`, { headers: { authorization: `Bearer ${token}`, 'x-lotuspond-client': 'app' } });
  assert.equal(((await who.json()) as { account: { email: string } }).account.email, email);
});
