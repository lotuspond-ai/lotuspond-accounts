// Every sign-in path, against the real schema (PGlite) and a stand-in for Hydra's admin API.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { accounts, auditEvents, emailTokens, hydraSessions, productSignIns, sessions } from '../src/db/cell-schema.ts';
import { directory, productClients } from '../src/db/directory-schema.ts';
import { csrfOf, linkIn, type Browser } from './support/browser.ts';
import { harness } from './support/harness.ts';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
afterEach(async () => { await h?.close(); });

const PASSWORD = 'correct horse battery';
const cell = () => h.dbs.cells.get('in')!.db;

async function signUp(b: Browser, o: { email?: string; challenge?: string; country?: string; password?: string; terms?: boolean } = {}) {
  const page = await (await b.get(o.challenge ? `/signup?login_challenge=${o.challenge}` : '/signup')).text();
  return b.post('/signup', {
    csrf: csrfOf(page), email: o.email ?? 'asha@example.com', name: 'Asha Rao', password: o.password ?? PASSWORD,
    country: o.country ?? 'IN', ...(o.terms === false ? {} : { accept_terms: 'yes' }), ...(o.challenge ? { login_challenge: o.challenge } : {}),
  });
}

async function confirmEmail(b: Browser, to = 'asha@example.com') {
  const link = new URL(linkIn(h.outbox.latest(to)!.text));
  const page = await (await b.get(link.pathname + link.search)).text();
  return b.post('/verify-email', { csrf: csrfOf(page), token: link.searchParams.get('token')! });
}

/** Sign in through the form. A browser that is already signed in is sent straight on, and that answer is returned. */
async function signIn(b: Browser, o: { email?: string; password?: string; challenge?: string } = {}) {
  const res = await b.get(o.challenge ? `/login?login_challenge=${o.challenge}` : '/login');
  if (res.status !== 200) return res;
  const page = await res.text();
  return b.post('/login', { csrf: csrfOf(page), email: o.email ?? 'asha@example.com', password: o.password ?? PASSWORD, ...(o.challenge ? { login_challenge: o.challenge } : {}) });
}

async function verifiedAccount(b: Browser) {
  await signUp(b);
  await confirmEmail(b);
  const [account] = await cell().select().from(accounts).where(eq(accounts.email, 'asha@example.com'));
  return account;
}

/* ---------- sign-up ---------- */

test('sign-up from a product: confirm the email, then Continue accepts the login', async () => {
  h = await harness();
  const b = h.browser();
  const challenge = h.hydra.newLogin();
  const res = await signUp(b, { challenge });
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /Confirm your email/);
  assert.match(page, /Continue to LotusPond Health/);
  assert.equal(h.hydra.accepted.length, 0, 'nothing is accepted before the email is confirmed');

  // Continue before confirming is refused.
  const early = await b.post('/login/continue', { csrf: csrfOf(page), login_challenge: challenge });
  assert.equal(early.status, 400);
  assert.match(await early.text(), /not confirmed yet/);

  assert.equal((await confirmEmail(b)).status, 200);
  const after = await b.post('/login/continue', { csrf: csrfOf(page), login_challenge: challenge });
  assert.equal(after.status, 303);
  assert.match(after.headers.get('location')!, /login_verifier=/);

  const [account] = await cell().select().from(accounts);
  assert.ok(account.emailVerifiedAt);
  assert.equal(account.region, 'in');
  const accepted = h.hydra.accepted[0];
  assert.equal(accepted.kind, 'login');
  assert.deepEqual(accepted.body, { subject: account.id, remember: true, remember_for: 30 * 24 * 3600, amr: ['pwd'], context: { region: 'in' } });
  const sids = await cell().select().from(hydraSessions);
  assert.deepEqual(sids.map(s => s.sid), [`sid-${challenge}`]);
});

test('the directory holds only an HMAC of the email, never the address', async () => {
  h = await harness();
  await signUp(h.browser());
  const [row] = await h.dbs.directory.db.select().from(directory);
  assert.equal(row.region, 'in');
  assert.doesNotMatch(row.emailHash, /asha|example/);
  assert.match(row.emailHash, /^[\w-]{43}$/);
});

test('sign-up refuses a country that is not open, a weak password and no agreement', async () => {
  h = await harness();
  const b = h.browser();
  const gb = await signUp(b, { country: 'GB' });
  assert.equal(gb.status, 400);
  assert.match(await gb.text(), /open to people living in India first/);
  assert.match(await (await signUp(b, { password: 'short' })).text(), /at least 10 characters/);
  assert.match(await (await signUp(b, { terms: false })).text(), /Agree to the LotusPond account terms/);
});

test('sign-up with a taken email answers as a new account would, and tells the owner by email', async () => {
  h = await harness();
  const first = await signUp(h.browser());
  assert.equal(first.status, 200);
  const firstPage = (await first.text()).replace(/name="csrf" value="[^"]*"/g, '');
  const before = h.outbox.messages.length;

  const again = await signUp(h.browser(), { email: 'ASHA@example.com ' });
  assert.equal(again.status, 200);
  assert.match(again.headers.get('set-cookie') ?? '', /lp_account=in\./, 'a session cookie, as for a new account');
  assert.equal((await again.text()).replace(/name="csrf" value="[^"]*"/g, ''), firstPage, 'the same page');

  assert.equal((await cell().select().from(accounts)).length, 1);
  assert.equal(h.outbox.messages.length, before + 1);
  const sent = h.outbox.latest('asha@example.com')!;
  assert.match(sent.subject, /already have a LotusPond account/);
  assert.match(sent.text, /\/forgot-password/);
});

test('a form posted without this browser\'s form token, or from another site, is refused', async () => {
  h = await harness();
  const b = h.browser();
  const page = await (await b.get('/signup')).text();
  const fields = { email: 'x@example.com', name: 'X', password: PASSWORD, country: 'IN', accept_terms: 'yes' };
  assert.equal((await b.post('/signup', { ...fields, csrf: 'forged' })).status, 403);
  assert.equal((await b.post('/signup', { ...fields, csrf: csrfOf(page) }, { origin: 'https://evil.example' })).status, 403);
  // Another browser's token does not work with this browser's cookie.
  const other = h.browser();
  const otherPage = await (await other.get('/signup')).text();
  assert.equal((await b.post('/signup', { ...fields, csrf: csrfOf(otherPage) })).status, 403);
  assert.equal((await cell().select().from(accounts)).length, 0);
});

/* ---------- sign-in ---------- */

test('a wrong password and an unknown email get the same answer, and both are audited only for real accounts', async () => {
  h = await harness();
  await verifiedAccount(h.browser());
  const wrong = await signIn(h.browser(), { password: 'not the password' });
  const unknown = await signIn(h.browser(), { email: 'nobody@example.com' });
  assert.equal(wrong.status, 400);
  assert.equal(unknown.status, 400);
  const message = /That email and password do not match an account/;
  assert.match(await wrong.text(), message);
  assert.match(await unknown.text(), message);
  const kinds = (await cell().select().from(auditEvents)).map(e => e.kind);
  assert.deepEqual(kinds.filter(k => k === 'sign_in_failed').length, 1);
});

test('signing in with a product accepts the login straight away for a confirmed account', async () => {
  h = await harness();
  const account = await verifiedAccount(h.browser());
  const challenge = h.hydra.newLogin();
  const res = await signIn(h.browser(), { challenge });
  assert.equal(res.status, 303);
  assert.equal((h.hydra.accepted.at(-1)!.body as { subject: string }).subject, account.id);
});

test('an unconfirmed account that signs in is sent a new link and asked to confirm first', async () => {
  h = await harness();
  await signUp(h.browser());
  const before = h.outbox.messages.length;
  const res = await signIn(h.browser(), { challenge: h.hydra.newLogin() });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Confirm your email/);
  assert.equal(h.outbox.messages.length, before + 1);
  assert.equal(h.hydra.accepted.length, 0);
});

test('sign-in is limited to 8 tries per email in 15 minutes', async () => {
  h = await harness();
  await verifiedAccount(h.browser());
  for (let i = 0; i < 8; i++) assert.equal((await signIn(h.browser(), { password: `wrong ${i}` })).status, 400);
  assert.equal((await signIn(h.browser())).status, 429, 'even the right password waits');
});

test('Hydra remembering the browser (skip) continues without a page; a disabled account is refused', async () => {
  h = await harness();
  const account = await verifiedAccount(h.browser());
  const skip = h.hydra.newLogin({ skip: true, subject: account.id });
  const res = await h.browser().get(`/login?login_challenge=${skip}`);
  assert.equal(res.status, 303);
  assert.equal(h.hydra.accepted.at(-1)!.challenge, skip);

  await cell().update(accounts).set({ status: 'disabled' }).where(eq(accounts.id, account.id));
  const again = h.hydra.newLogin({ skip: true, subject: account.id });
  const refused = await h.browser().get(`/login?login_challenge=${again}`);
  assert.equal(refused.status, 303);
  assert.equal(h.hydra.rejected.at(-1)!.body!.error, 'login_required');
});

test('an Accounts session signs in to a product without a password, unless the product asks for a fresh sign-in', async () => {
  h = await harness();
  const b = h.browser();
  await verifiedAccount(b);
  assert.equal((await b.get(`/login?login_challenge=${h.hydra.newLogin()}`)).status, 303);
  const fresh = await b.get(`/login?login_challenge=${h.hydra.newLogin({ prompt: 'login' })}`);
  assert.equal(fresh.status, 200);
  assert.match(await fresh.text(), /Sign in\./);
});

test('a product that sends screen_hint=signup opens the sign-up page; a signed-in browser still goes straight through', async () => {
  h = await harness();
  const challenge = h.hydra.newLogin({ screenHint: 'signup' });
  const res = await h.browser().get(`/login?login_challenge=${challenge}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/signup?login_challenge=${challenge}`);
  const b = h.browser();
  await verifiedAccount(b);
  assert.equal((await b.get(`/login?login_challenge=${h.hydra.newLogin({ screenHint: 'signup' })}`)).status, 303);
});

test('an expired or unknown challenge shows a page that says to start again', async () => {
  h = await harness();
  const res = await h.browser().get('/login?login_challenge=login00000000-gone');
  assert.equal(res.status, 410);
  assert.match(await res.text(), /This sign-in has expired/);
});

/* ---------- email links ---------- */

test('a confirmation link works once, and not after it expires', async () => {
  h = await harness();
  const b = h.browser();
  await signUp(b);
  const link = new URL(linkIn(h.outbox.latest('asha@example.com')!.text));
  const token = link.searchParams.get('token')!;
  const page = await (await b.get(link.pathname + link.search)).text();
  assert.equal((await b.post('/verify-email', { csrf: csrfOf(page), token })).status, 200);
  assert.equal((await b.post('/verify-email', { csrf: csrfOf(page), token })).status, 410);
  assert.equal((await b.get(link.pathname + link.search)).status, 410);

  // A fresh link, aged past its lifetime.
  const res = await signIn(b);
  assert.equal(res.status, 302, 'already signed in here, so /login goes to the account page');
  assert.equal(res.headers.get('location'), '/account');
  await signUp(h.browser(), { email: 'ravi@example.com' });
  const late = new URL(linkIn(h.outbox.latest('ravi@example.com')!.text));
  await cell().update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await h.browser().get(late.pathname + late.search)).status, 410);
});

test('opening a confirmation link does not use it: only the button does', async () => {
  h = await harness();
  const b = h.browser();
  await signUp(b);
  const link = new URL(linkIn(h.outbox.latest('asha@example.com')!.text));
  await b.get(link.pathname + link.search);
  await b.get(link.pathname + link.search);
  const [account] = await cell().select().from(accounts);
  assert.equal(account.emailVerifiedAt, null);
});

/* ---------- password reset ---------- */

test('forgot-password answers the same for every address and emails only real accounts', async () => {
  h = await harness();
  await verifiedAccount(h.browser());
  const ask = async (email: string) => {
    const b = h.browser();
    const page = await (await b.get('/forgot-password')).text();
    return b.post('/forgot-password', { csrf: csrfOf(page), email });
  };
  const before = h.outbox.messages.length;
  const real = await ask('asha@example.com');
  const fake = await ask('nobody@example.com');
  assert.equal(real.status, fake.status);
  assert.equal(await real.text(), await fake.text());
  await new Promise(r => setTimeout(r, 50));
  assert.equal(h.outbox.messages.length, before + 1);
  assert.match(h.outbox.messages[0].subject, /Reset your LotusPond password/);
});

test('a reset link sets a new password once, ends every session, and revokes every Hydra session', async () => {
  h = await harness();
  const b = h.browser();
  const account = await verifiedAccount(b);
  await signIn(h.browser(), { challenge: h.hydra.newLogin() });
  await signIn(h.browser(), { challenge: h.hydra.newLogin() });
  const sids = (await cell().select().from(hydraSessions)).map(s => s.sid).sort();
  assert.equal(sids.length, 2);

  const asker = h.browser();
  const page = await (await asker.get('/forgot-password')).text();
  await asker.post('/forgot-password', { csrf: csrfOf(page), email: 'asha@example.com' });
  await asker.post('/forgot-password', { csrf: csrfOf(page), email: 'asha@example.com' });
  await new Promise(r => setTimeout(r, 50));
  const [newest, older] = h.outbox.messages.filter(m => /Reset/.test(m.subject)).map(m => new URL(linkIn(m.text)));
  const form = await (await asker.get(newest.pathname + newest.search)).text();
  const token = newest.searchParams.get('token')!;
  assert.match(await (await asker.post('/reset-password', { csrf: csrfOf(form), token, password: 'short' })).text(), /at least 10/);
  assert.equal((await asker.post('/reset-password', { csrf: csrfOf(form), token, password: 'a brand new passphrase' })).status, 200);

  assert.deepEqual(h.hydra.revoked.sort(), sids);
  assert.equal((await cell().select().from(sessions).where(eq(sessions.accountId, account.id))).length, 0);
  assert.equal((await b.get('/account')).status, 302, 'the old browser is signed out');
  assert.equal((await asker.post('/reset-password', { csrf: csrfOf(form), token, password: 'another passphrase!' })).status, 410, 'once only');
  assert.equal((await asker.get(older.pathname + older.search)).status, 410, 'the older link died with it');
  assert.equal((await signIn(h.browser())).status, 400, 'the old password no longer works');
  assert.equal((await signIn(h.browser(), { password: 'a brand new passphrase' })).status, 303);
});

test('a reset link also confirms the email, since it proves the mailbox', async () => {
  h = await harness();
  await signUp(h.browser());
  const b = h.browser();
  const page = await (await b.get('/forgot-password')).text();
  await b.post('/forgot-password', { csrf: csrfOf(page), email: 'asha@example.com' });
  await new Promise(r => setTimeout(r, 50));
  const link = new URL(linkIn(h.outbox.messages[0].text));
  const form = await (await b.get(link.pathname + link.search)).text();
  await b.post('/reset-password', { csrf: csrfOf(form), token: link.searchParams.get('token')!, password: 'a brand new passphrase' });
  const [account] = await cell().select().from(accounts);
  assert.ok(account.emailVerifiedAt);
  // The sign-up may have been someone else's: its name and terms acceptance are dropped.
  assert.equal(account.name, 'asha');
  assert.equal(account.termsVersionAccepted, null);
});

test('a reset of a confirmed account keeps its name and terms', async () => {
  h = await harness();
  await verifiedAccount(h.browser());
  const b = h.browser();
  const page = await (await b.get('/forgot-password')).text();
  await b.post('/forgot-password', { csrf: csrfOf(page), email: 'asha@example.com' });
  await new Promise(r => setTimeout(r, 50));
  const link = new URL(linkIn(h.outbox.latest('asha@example.com')!.text));
  const form = await (await b.get(link.pathname + link.search)).text();
  await b.post('/reset-password', { csrf: csrfOf(form), token: link.searchParams.get('token')!, password: 'a brand new passphrase' });
  const [account] = await cell().select().from(accounts);
  assert.equal(account.name, 'Asha Rao');
  assert.ok(account.termsVersionAccepted);
});

/* ---------- the account page ---------- */

test('changing the password needs the current one, keeps this session and revokes product sessions', async () => {
  h = await harness();
  const b = h.browser();
  await verifiedAccount(b);
  await signIn(b, { challenge: h.hydra.newLogin() });
  const other = h.browser();
  await signIn(other);
  const page = await (await b.get('/account')).text();
  const wrong = await b.post('/account/password', { csrf: csrfOf(page), current_password: 'nope nope nope', new_password: 'a brand new passphrase' });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /current password is not right/);
  const ok = await b.post('/account/password', { csrf: csrfOf(page), current_password: PASSWORD, new_password: 'a brand new passphrase' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Password changed/);
  assert.equal(h.hydra.revoked.length, 1);
  assert.equal((await b.get('/account')).status, 200, 'this browser stays signed in');
  assert.equal((await other.get('/account')).status, 302, 'other browsers are signed out');
});

/** One product's card on the account page. */
const card = (page: string, product: string) => new RegExp(`<li class="product" aria-labelledby="product-${product}">([\\s\\S]*?)</li>`).exec(page)?.[1] ?? '';

test('the account page needs a session, and shows each product, connected or not, after consent', async () => {
  h = await harness({ PRODUCT_URLS: 'health=https://health.example,works=https://works.example' });
  assert.equal((await h.browser().get('/account')).status, 302);
  const b = h.browser();
  const account = await verifiedAccount(b);
  let page = await (await b.get('/account')).text();
  assert.match(page, /asha@example.com/);
  assert.match(page, /Not connected to a product yet/);
  for (const p of ['health', 'works']) assert.match(card(page, p), /Not used yet/, p);

  await h.browser().get(`/consent?consent_challenge=${h.hydra.newConsent({ subject: account.id })}`);
  page = await (await b.get('/account')).text();
  assert.match(page, /Connected to one product/);
  const health = card(page, 'health');
  assert.match(health, /<h3 id="product-health">LotusPond Health<\/h3><span class="tag">Connected<\/span>/);
  assert.match(health, /First used<\/dt><dd>\d{1,2} [A-Z][a-z]{2} \d{4}<\/dd>/);
  assert.match(health, /Last signed in/);
  assert.match(health, /<a class="product__open" href="https:\/\/health.example">Open LotusPond Health/);
  assert.match(card(page, 'works'), /Not used yet/);
  assert.match(page, /receives your email, your name and the region/);
});

test('a product with no client registered yet shows as not available, with no link', async () => {
  h = await harness({ PRODUCT_URLS: 'health=https://health.example,works=https://works.example' });
  await h.dbs.directory.db.delete(productClients).where(eq(productClients.product, 'works'));
  const b = h.browser();
  await verifiedAccount(b);
  const works = card(await (await b.get('/account')).text(), 'works');
  assert.match(works, /Not available yet/);
  assert.match(works, /does not sign in with this account yet/);
  assert.doesNotMatch(works, /product__open/);
});

/* ---------- consent ---------- */

test('consent for a LotusPond product grants what it asked for, with the region always in the ID token', async () => {
  h = await harness();
  const account = await verifiedAccount(h.browser());
  const res = await h.browser().get(`/consent?consent_challenge=${h.hydra.newConsent({ subject: account.id, scopes: ['openid', 'email', 'admin:everything'] })}`);
  assert.equal(res.status, 303);
  const body = h.hydra.accepted.at(-1)!.body as { grant_scope: string[]; session: { id_token: Record<string, unknown> } };
  assert.deepEqual(body.grant_scope, ['openid', 'email'], 'scopes outside LotusPond\'s list are dropped');
  assert.deepEqual(body.session.id_token, { region: 'in', email: 'asha@example.com', email_verified: true });
  assert.equal((await cell().select().from(productSignIns)).length, 1);

  await h.browser().get(`/consent?consent_challenge=${h.hydra.newConsent({ subject: account.id, scopes: ['openid', 'profile'] })}`);
  const named = h.hydra.accepted.at(-1)!.body as { session: { id_token: Record<string, unknown> } };
  assert.deepEqual(named.session.id_token, { region: 'in', name: 'Asha Rao' });
});

test('consent is refused for anything that is not a LotusPond product, and for an unconfirmed account', async () => {
  h = await harness();
  const account = await verifiedAccount(h.browser());
  await h.browser().get(`/consent?consent_challenge=${h.hydra.newConsent({ subject: account.id, clientId: 'someone-else' })}`);
  assert.equal(h.hydra.rejected.at(-1)!.body!.error, 'access_denied');
  await cell().update(accounts).set({ emailVerifiedAt: null });
  await h.browser().get(`/consent?consent_challenge=${h.hydra.newConsent({ subject: account.id })}`);
  assert.equal(h.hydra.rejected.length, 2);
  assert.equal(h.hydra.accepted.filter(a => a.kind === 'consent').length, 0);
});

/* ---------- signing out ---------- */

test('a product\'s sign-out asks first; signing out ends the Accounts session and accepts the logout', async () => {
  h = await harness();
  const b = h.browser();
  const account = await verifiedAccount(b);
  await signIn(b, { challenge: h.hydra.newLogin() });
  const [{ sid }] = await cell().select().from(hydraSessions);
  const challenge = h.hydra.newLogout({ subject: account.id, sid });
  const page = await (await b.get(`/logout?logout_challenge=${challenge}`)).text();
  assert.match(page, /Sign out of LotusPond\?/);
  const res = await b.post('/logout', { csrf: csrfOf(page), logout_challenge: challenge, action: 'sign_out' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://health.example/login');
  assert.equal((await b.get('/account')).status, 302);
  assert.equal((await cell().select().from(hydraSessions)).length, 0);
});

test('"Stay signed in" rejects the logout and keeps the session', async () => {
  h = await harness();
  const b = h.browser();
  const account = await verifiedAccount(b);
  const challenge = h.hydra.newLogout({ subject: account.id, sid: 'sid-x' });
  const page = await (await b.get(`/logout?logout_challenge=${challenge}`)).text();
  await b.post('/logout', { csrf: csrfOf(page), logout_challenge: challenge, action: 'stay' });
  assert.equal(h.hydra.rejected.at(-1)!.kind, 'logout');
  assert.equal((await b.get('/account')).status, 200);
});

test('signing out on the account page goes through Hydra and is not asked again', async () => {
  h = await harness();
  const b = h.browser();
  const account = await verifiedAccount(b);
  const page = await (await b.get('/account')).text();
  const res = await b.post('/account/sign-out', { csrf: csrfOf(page) });
  assert.equal(res.headers.get('location'), '/oauth2/sessions/logout');
  const challenge = h.hydra.newLogout({ subject: account.id, sid: 'sid-y' });
  const done = await b.get(`/logout?logout_challenge=${challenge}`);
  assert.equal(done.status, 303, 'no confirmation page');
  assert.equal(h.hydra.accepted.at(-1)!.kind, 'logout');
  // The mark works once.
  const again = await b.get(`/logout?logout_challenge=${h.hydra.newLogout({ subject: account.id, sid: 'sid-z' })}`);
  assert.equal(again.status, 200);
});

/* ---------- what is never shown or kept ---------- */

test('no email address or token is written to the audit log', async () => {
  h = await harness();
  const b = h.browser();
  await verifiedAccount(b);
  await signIn(h.browser(), { password: 'wrong wrong wrong' });
  const rows = JSON.stringify(await cell().select().from(auditEvents));
  assert.doesNotMatch(rows, /asha@example\.com|127\.0\.0\.1/);
  assert.deepEqual(new Set((await cell().select().from(auditEvents)).map(e => e.kind)), new Set(['account_created', 'email_verified', 'sign_in_failed']));
});

test('the console: Products, Profile and Security each need a session and mark their own place in the navigation', async () => {
  h = await harness();
  for (const path of ['/account', '/account/profile', '/account/security']) assert.equal((await h.browser().get(path)).status, 302, path);
  const b = h.browser();
  await verifiedAccount(b);
  for (const [path, label] of [['/account', 'Products'], ['/account/profile', 'Profile'], ['/account/security', 'Security']]) {
    const page = await (await b.get(path)).text();
    assert.match(page, new RegExp(`<h1 class="screen-title">${label}</h1>`), path);
    assert.match(page, new RegExp(`aria-current="page"><svg[^>]*>[\\s\\S]*?</svg><span>${label}</span>`), path);
    assert.equal((page.match(/aria-current="page"/g) ?? []).length, 1, path);
    assert.match(page, /action="\/account\/sign-out"/, `${path}: signing out is always at hand`);
  }
  const profile = await (await b.get('/account/profile')).text();
  const renamed = await b.post('/account/name', { csrf: csrfOf(profile), name: 'Asha R.' });
  assert.match(await renamed.text(), /<h1 class="screen-title">Profile<\/h1>[\s\S]*Name saved\./, 'saving a name stays on Profile');
});
