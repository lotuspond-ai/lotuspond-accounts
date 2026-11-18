// The Accounts web app: Hydra's login, consent and logout app, and every page a person sees. Hydra itself serves
// /oauth2/*, /userinfo and /.well-known/* (deploy/Caddyfile).
//
// Flow: a product sends the browser to Hydra; Hydra sends it to /login?login_challenge=…; Accounts signs the person
// in and accepts the challenge; Hydra sends it to /consent?consent_challenge=…, which Accounts accepts for LotusPond's
// own products only; Hydra then returns the browser to the product with a code.
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import type { Config, Region } from './config.ts';
import type { Database } from './db/client.ts';
import { productClients } from './db/directory-schema.ts';
import { AccountService, type Account, type AuditContext, type Product, type Problem } from './accounts.ts';
import { HydraError, isChallenge, type Hydra, type LoginRequest } from './hydra.ts';
import { hmac, randomToken, safeEqual } from './lib/crypto.ts';
import type { Keys } from './lib/keys.ts';
import { RateLimiter } from './lib/rate-limit.ts';
import { fromRoot } from './lib/paths.ts';
import { normaliseEmail } from './lib/directory.ts';
import { Outbox, type Mailer } from './mail/mailer.ts';
import { resetPassword as resetMessage, verifyEmail as verifyMessage } from './mail/messages.ts';
import * as pages from './views/pages.ts';
import { buildStylesheet } from './views/styles.ts';

export interface Deps {
  config: Pick<Config, 'publicUrl' | 'trustProxy' | 'openCountries' | 'sessionTtlMs' | 'secureCookies' | 'env'>;
  directory: Pick<Database, 'ping' | 'db'>;
  cells: Map<Region, Pick<Database, 'ping' | 'db'>>;
  hydra: Hydra;
  keys: Keys;
  mailer: Mailer;
}

export interface HealthReport {
  status: 'ok' | 'unavailable';
  directory: boolean;
  cells: Partial<Record<Region, boolean>>;
  hydra: boolean;
}

/** Scopes LotusPond's own products may be granted. */
const GRANTABLE = new Set(['openid', 'email', 'profile', 'offline_access', 'offline', 'lotuspond:region']);
const MINUTE = 60_000;

const FONTS: Record<string, string> = {
  'atkinson.woff2': fromRoot('node_modules', '@fontsource-variable', 'atkinson-hyperlegible-next', 'files', 'atkinson-hyperlegible-next-latin-wght-normal.woff2'),
  'platypi.woff2': fromRoot('node_modules', '@fontsource-variable', 'platypi', 'files', 'platypi-latin-wght-normal.woff2'),
};

export function createApp(deps: Deps) {
  const { config, hydra, keys, mailer } = deps;
  const service = new AccountService({ directory: deps.directory, cells: deps.cells }, keys, config.openCountries);
  const app = new Hono();
  const stylesheet = buildStylesheet();
  const fonts = new Map(Object.entries(FONTS).map(([name, file]) => [name, fs.readFileSync(file)]));
  const origin = new URL(config.publicUrl).origin;
  const sessionCookie = config.secureCookies ? '__Host-lp_account' : 'lp_account';
  const formCookie = config.secureCookies ? '__Host-lp_form' : 'lp_form';
  const signOutCookie = config.secureCookies ? '__Host-lp_signout' : 'lp_signout';
  const cookieBase = { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' as const };

  const limits = {
    signInByIp: new RateLimiter(20, 15 * MINUTE),
    // Keyed on email and address together, so someone elsewhere cannot lock a person out of their own account.
    signInByEmail: new RateLimiter(8, 15 * MINUTE),
    passwordByAccount: new RateLimiter(8, 15 * MINUTE),
    signUpByIp: new RateLimiter(config.env === 'production' ? 10 : 500, 60 * MINUTE),
    resetByIp: new RateLimiter(10, 60 * MINUTE),
    resetByEmail: new RateLimiter(3, 60 * MINUTE),
    verifyByAccount: new RateLimiter(5, 60 * MINUTE),
  };

  /* ---------- headers ---------- */

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    referrerPolicy: 'no-referrer',
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
  }));
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-store');
  });

  /* ---------- helpers ---------- */

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const auditCtx = (c: Context): AuditContext => ({ ipHash: hmac(keys.audit, clientIp(c)).slice(0, 22), userAgent: c.req.header('user-agent') });

  /** The form token for this browser: an HMAC of a random cookie value. Sets the cookie the first time. */
  const formToken = (c: Context): string => {
    let value = getCookie(c, formCookie);
    if (!value || !/^[\w-]{43}$/.test(value)) {
      value = randomToken();
      setCookie(c, formCookie, value, { ...cookieBase, sameSite: 'Strict' });
    }
    return hmac(keys.forms, value);
  };

  /** Reject a form POST from another site, or without this browser's form token. */
  const checkForm = (c: Context, body: Record<string, unknown>): boolean => {
    const from = c.req.header('origin');
    if (from && from !== origin) return false;
    const value = getCookie(c, formCookie);
    const sent = typeof body.csrf === 'string' ? body.csrf : '';
    return !!value && !!sent && safeEqual(sent, hmac(keys.forms, value));
  };

  const form = async (c: Context): Promise<Record<string, string>> => {
    const raw = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v.slice(0, 4096);
    return out;
  };

  const page = (c: Context, body: string, status: 200 | 400 | 403 | 404 | 410 | 429 | 502 = 200) => c.html(body, status);

  const stale = (c: Context) => page(c, pages.problemPage({
    title: 'This sign-in has expired.',
    message: 'Go back to the LotusPond product you were using and start again.',
  }), 410);

  const refused = (c: Context) => page(c, pages.problemPage({
    title: 'Something went wrong.',
    message: 'This page was opened from somewhere it should not have been, or it was open too long. Go back and try again.',
  }), 403);

  const tooMany = (c: Context, wait: number) => page(c, pages.problemPage({
    title: 'Too many attempts.',
    message: `Wait ${Math.max(1, Math.ceil(wait / 60))} minutes, then try again.`,
  }), 429);

  const signedInAccount = async (c: Context) => service.session(getCookie(c, sessionCookie));

  const startSession = async (c: Context, account: Account) => {
    const { token, expiresAt } = await service.startSession(account, config.sessionTtlMs, c.req.header('user-agent'));
    setCookie(c, sessionCookie, token, { ...cookieBase, expires: expiresAt });
  };

  const productOf = async (clientId: string | undefined): Promise<Product | null> => {
    if (!clientId) return null;
    const [row] = await deps.directory.db.select().from(productClients).where(eq(productClients.clientId, clientId)).limit(1);
    return row?.product ?? null;
  };

  /** The product behind a sign-in challenge, or null when there is none. */
  const productForChallenge = async (challenge: string | undefined): Promise<Product | null> =>
    challenge ? productOf((await hydra.getLogin(challenge)).client.client_id) : null;

  const sendVerification = async (account: Account) => {
    const token = await service.issueToken(account, 'verify');
    await mailer.send(verifyMessage(account.email, account.name, `${config.publicUrl}/verify-email?token=${encodeURIComponent(token)}`));
  };

  const revokeAll = async (sids: string[]) => {
    // A session Hydra no longer knows is already gone; any other failure must not stop the person's own change.
    await Promise.all(sids.map(sid => hydra.revokeSession(sid).catch(() => {})));
  };

  /**
   * Does the product want the sign-up page? Hydra refuses OpenID Connect's prompt=create, so products send
   * screen_hint=signup, which Hydra passes through in the request.
   */
  const wantsSignUp = (req: LoginRequest): boolean => {
    try {
      return new URL(req.request_url).searchParams.get('screen_hint') === 'signup';
    } catch {
      return false;
    }
  };

  /** Does this login request insist on a fresh password (prompt=login or max_age)? */
  const wantsFreshLogin = (req: LoginRequest): boolean => {
    try {
      const q = new URL(req.request_url).searchParams;
      return (q.get('prompt') ?? '').split(' ').includes('login') || q.has('max_age');
    } catch {
      return true;
    }
  };

  /** Accept Hydra's login request for this account and send the browser on. */
  const finishLogin = async (c: Context, challenge: string, account: Account) => {
    const req = await hydra.getLogin(challenge);
    if (req.skip && req.subject !== account.id) {
      // Hydra remembers someone else in this browser: it must not be swapped silently.
      return c.redirect(await hydra.rejectLogin(challenge, { error: 'login_required', error_description: 'Another account is signed in.' }), 303);
    }
    const redirectTo = await hydra.acceptLogin(challenge, {
      subject: account.id,
      remember: true,
      remember_for: Math.floor(config.sessionTtlMs / 1000),
      amr: ['pwd'],
      context: { region: account.region },
    });
    await service.rememberHydraSession(account, req.session_id);
    return c.redirect(redirectTo, 303);
  };

  const hydraGuard = async (c: Context, run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof HydraError && [404, 409, 410].includes(e.status)) return stale(c);
      if (e instanceof HydraError) {
        return page(c, pages.problemPage({ title: 'Sign-in is not available right now.', message: 'Try again in a few minutes.' }), 502);
      }
      throw e;
    }
  };

  /* ---------- assets and health ---------- */

  app.get('/assets/accounts.css', c => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(stylesheet);
  });
  app.get('/assets/fonts/:name', c => {
    const font = fonts.get(c.req.param('name'));
    if (!font) return c.notFound();
    c.header('Content-Type', 'font/woff2');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(font);
  });

  /** Ready only when every database this server holds and Hydra answer. Reports which part failed, never why. */
  app.get('/api/health', async c => {
    const regions = [...deps.cells.keys()];
    const [directory, hydraReady, ...cellResults] = await Promise.all([
      deps.directory.ping(),
      hydra.ready(),
      ...regions.map(r => deps.cells.get(r)!.ping()),
    ]);
    const cells = Object.fromEntries(regions.map((r, i) => [r, cellResults[i]]));
    const ok = directory && hydraReady && cellResults.every(Boolean);
    return c.json<HealthReport>({ status: ok ? 'ok' : 'unavailable', directory, cells, hydra: hydraReady }, ok ? 200 : 503);
  });

  app.get('/', c => c.redirect('/account', 302));

  /* ---------- sign-in ---------- */

  app.get('/login', c => hydraGuard(c, async () => {
    const challenge = c.req.query('login_challenge');
    if (challenge === undefined) {
      if (await signedInAccount(c)) return c.redirect('/account', 302);
      return page(c, pages.signIn({ csrf: formToken(c), product: null }));
    }
    if (!isChallenge(challenge)) return stale(c);
    const req = await hydra.getLogin(challenge);
    const product = await productOf(req.client.client_id);
    if (req.skip) {
      // Hydra already signed this browser in: confirm the account still may, then continue without a page.
      const account = await service.findById(req.subject);
      if (!account || account.status !== 'active' || !account.emailVerifiedAt) {
        return c.redirect(await hydra.rejectLogin(challenge, { error: 'login_required', error_description: 'Sign in again.' }), 303);
      }
      return finishLogin(c, challenge, account);
    }
    const signedIn = await signedInAccount(c);
    if (signedIn?.account.emailVerifiedAt && !wantsFreshLogin(req)) return finishLogin(c, challenge, signedIn.account);
    if (wantsSignUp(req)) return c.redirect(`/signup?login_challenge=${encodeURIComponent(challenge)}`, 302);
    return page(c, pages.signIn({ csrf: formToken(c), challenge, product, email: req.oidc_context?.login_hint }));
  }));

  app.post('/login', c => hydraGuard(c, async () => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const challenge = isChallenge(body.login_challenge) ? body.login_challenge : undefined;
    const product = await productForChallenge(challenge);
    const email = normaliseEmail(body.email ?? '');
    const ip = clientIp(c);
    const emailKey = `${email} ${ip}`;
    const wait = Math.max(limits.signInByIp.hit(ip), email ? limits.signInByEmail.hit(emailKey) : 0);
    if (wait) return tooMany(c, wait);
    const account = email && body.password ? await service.authenticate(email, body.password, auditCtx(c)) : null;
    if (!account) {
      return page(c, pages.signIn({
        csrf: formToken(c), challenge, product, email,
        problems: [{ field: 'form', code: 'invalid_credentials', message: 'That email and password do not match an account. Check them and try again.' }],
      }), 400);
    }
    limits.signInByEmail.reset(emailKey);
    await startSession(c, account);
    if (!account.emailVerifiedAt) {
      if (!limits.verifyByAccount.hit(account.id)) await sendVerification(account);
      return page(c, pages.checkEmail({ csrf: formToken(c), email: account.email, challenge, product }));
    }
    return challenge ? finishLogin(c, challenge, account) : c.redirect('/account', 303);
  }));

  /** After confirming the email in another tab: carry on with the sign-in. */
  app.post('/login/continue', c => hydraGuard(c, async () => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const challenge = isChallenge(body.login_challenge) ? body.login_challenge : undefined;
    const signedIn = await signedInAccount(c);
    if (!signedIn) return c.redirect(challenge ? `/login?login_challenge=${encodeURIComponent(challenge)}` : '/login', 303);
    if (!signedIn.account.emailVerifiedAt) {
      const product = await productForChallenge(challenge);
      return page(c, pages.checkEmail({
        csrf: formToken(c), email: signedIn.account.email, challenge, product,
        problem: 'Your email is not confirmed yet. Open the link we sent, confirm, then choose Continue.',
      }), 400);
    }
    return challenge ? finishLogin(c, challenge, signedIn.account) : c.redirect('/account', 303);
  }));

  /* ---------- sign-up ---------- */

  app.get('/signup', c => hydraGuard(c, async () => {
    const challenge = c.req.query('login_challenge');
    const valid = isChallenge(challenge) ? challenge : undefined;
    const product = await productForChallenge(valid);
    return page(c, pages.signUp({ csrf: formToken(c), challenge: valid, product, openCountries: config.openCountries }));
  }));

  app.post('/signup', c => hydraGuard(c, async () => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const challenge = isChallenge(body.login_challenge) ? body.login_challenge : undefined;
    const product = await productForChallenge(challenge);
    const wait = limits.signUpByIp.hit(clientIp(c));
    if (wait) return tooMany(c, wait);
    const result = await service.signUp({
      email: body.email ?? '', password: body.password ?? '', name: body.name ?? '', country: body.country ?? '', acceptTerms: body.accept_terms === 'yes',
    }, auditCtx(c));
    if ('problem' in result) {
      const problems: Problem[] = [result.problem];
      return page(c, pages.signUp({
        csrf: formToken(c), challenge, product, problems, openCountries: config.openCountries,
        values: { email: body.email, name: body.name, country: body.country },
      }), 400);
    }
    await startSession(c, result.account);
    limits.verifyByAccount.hit(result.account.id);
    await sendVerification(result.account);
    return page(c, pages.checkEmail({ csrf: formToken(c), email: result.account.email, challenge, product }));
  }));

  /* ---------- confirming an email ---------- */

  // The link opens a page with a button rather than confirming on GET, so a mail scanner that fetches links cannot
  // use it up.
  app.get('/verify-email', async c => {
    const token = c.req.query('token') ?? '';
    if (!(await service.tokenIsLive(token, 'verify'))) return page(c, pages.linkExpired({ what: 'confirm' }), 410);
    return page(c, pages.confirmEmail({ csrf: formToken(c), token }));
  });

  app.post('/verify-email', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const account = await service.verifyEmail(body.token ?? '', auditCtx(c));
    if (!account) return page(c, pages.linkExpired({ what: 'confirm' }), 410);
    return page(c, pages.emailConfirmed());
  });

  app.post('/verify-email/resend', c => hydraGuard(c, async () => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const challenge = isChallenge(body.login_challenge) ? body.login_challenge : undefined;
    const signedIn = await signedInAccount(c);
    if (!signedIn) return c.redirect('/login', 303);
    const product = await productForChallenge(challenge);
    const wait = limits.verifyByAccount.hit(signedIn.account.id);
    if (wait) return tooMany(c, wait);
    if (!signedIn.account.emailVerifiedAt) await sendVerification(signedIn.account);
    return page(c, pages.checkEmail({ csrf: formToken(c), email: signedIn.account.email, challenge, product, notice: 'We sent a new link. Older links still work until they expire.' }));
  }));

  /* ---------- password reset ---------- */

  app.get('/forgot-password', c => page(c, pages.forgotPassword({ csrf: formToken(c) })));

  app.post('/forgot-password', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const email = normaliseEmail(body.email ?? '');
    const wait = Math.max(limits.resetByIp.hit(clientIp(c)), email ? limits.resetByEmail.hit(email) : 0);
    if (wait) return tooMany(c, wait);
    // The answer is the same whether or not the account exists, and is sent before even the lookup runs, so its
    // timing says nothing about the address.
    if (email) {
      void (async () => {
        const account = await service.findByEmail(email);
        if (!account || account.status !== 'active') return;
        const token = await service.issueToken(account, 'reset');
        await mailer.send(resetMessage(account.email, account.name, `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`));
      })().catch(() => console.error('A password reset email could not be sent.'));
    }
    return page(c, pages.resetSent());
  });

  app.get('/reset-password', async c => {
    const token = c.req.query('token') ?? '';
    if (!(await service.tokenIsLive(token, 'reset'))) return page(c, pages.linkExpired({ what: 'reset' }), 410);
    return page(c, pages.resetForm({ csrf: formToken(c), token }));
  });

  app.post('/reset-password', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const token = body.token ?? '';
    const result = await service.resetPassword(token, body.password ?? '', auditCtx(c));
    if (!result) return page(c, pages.linkExpired({ what: 'reset' }), 410);
    if ('problem' in result) return page(c, pages.resetForm({ csrf: formToken(c), token, problem: result.problem }), 400);
    await revokeAll(result.revoke);
    deleteCookie(c, sessionCookie, { path: '/', secure: config.secureCookies });
    return page(c, pages.resetDone());
  });

  /* ---------- the account page ---------- */

  const accountPage = async (c: Context, account: Account, extra: Partial<Parameters<typeof pages.accountPage>[0]> = {}, status: 200 | 400 = 200) =>
    page(c, pages.accountPage({ csrf: formToken(c), account, products: await service.connectedProducts(account), ...extra }), status);

  app.get('/account', async c => {
    const signedIn = await signedInAccount(c);
    if (!signedIn) return c.redirect('/login', 302);
    return accountPage(c, signedIn.account);
  });

  app.post('/account/name', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const signedIn = await signedInAccount(c);
    if (!signedIn) return c.redirect('/login', 303);
    const result = await service.rename(signedIn.account, body.name ?? '');
    if ('problem' in result) return accountPage(c, signedIn.account, { nameProblem: result.problem }, 400);
    return accountPage(c, result, { notice: 'Name saved.' });
  });

  app.post('/account/password', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const signedIn = await signedInAccount(c);
    if (!signedIn) return c.redirect('/login', 303);
    const wait = limits.passwordByAccount.hit(signedIn.account.id);
    if (wait) return tooMany(c, wait);
    const result = await service.changePassword(signedIn.account, body.current_password ?? '', body.new_password ?? '', { sessionDigest: signedIn.digest }, auditCtx(c));
    if ('problem' in result) return accountPage(c, signedIn.account, { passwordProblem: result.problem }, 400);
    limits.passwordByAccount.reset(signedIn.account.id);
    await revokeAll(result.revoke);
    return accountPage(c, signedIn.account, { notice: 'Password changed. You are signed out of LotusPond products everywhere; sign in to them again.' });
  });

  /** Sign out of Accounts here, then let Hydra end its session too (and tell the products). */
  app.post('/account/sign-out', async c => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    await service.endSession(getCookie(c, sessionCookie));
    deleteCookie(c, sessionCookie, { path: '/', secure: config.secureCookies });
    // A two-minute mark that this browser asked to sign out, so the logout page need not ask again.
    setCookie(c, signOutCookie, hmac(keys.forms, 'sign-out'), { ...cookieBase, sameSite: 'Strict', maxAge: 120 });
    return c.redirect('/oauth2/sessions/logout', 303);
  });

  /* ---------- Hydra: consent ---------- */

  app.get('/consent', c => hydraGuard(c, async () => {
    const challenge = c.req.query('consent_challenge');
    if (!isChallenge(challenge)) return stale(c);
    const req = await hydra.getConsent(challenge);
    const product = await productOf(req.client.client_id);
    if (!product) {
      // Only LotusPond's own products sign in with Accounts. Anything else is refused, with no consent screen.
      return c.redirect(await hydra.rejectConsent(challenge, { error: 'access_denied', error_description: 'This application cannot use LotusPond accounts.' }), 303);
    }
    const account = await service.findById(req.subject);
    if (!account || account.status !== 'active' || !account.emailVerifiedAt) {
      return c.redirect(await hydra.rejectConsent(challenge, { error: 'access_denied', error_description: 'Sign in again.' }), 303);
    }
    const scopes = req.requested_scope.filter(s => GRANTABLE.has(s));
    const idToken: Record<string, unknown> = { region: account.region };
    if (scopes.includes('email')) Object.assign(idToken, { email: account.email, email_verified: true });
    if (scopes.includes('profile')) idToken.name = account.name;
    await service.recordProductSignIn(account, product);
    if (req.login_session_id) await service.rememberHydraSession(account, req.login_session_id);
    return c.redirect(await hydra.acceptConsent(challenge, {
      grant_scope: scopes,
      grant_access_token_audience: req.requested_access_token_audience,
      remember: true,
      remember_for: Math.floor(config.sessionTtlMs / 1000),
      session: { id_token: idToken },
    }), 303);
  }));

  /* ---------- Hydra: logout ---------- */

  app.get('/logout', c => hydraGuard(c, async () => {
    const challenge = c.req.query('logout_challenge');
    if (!isChallenge(challenge)) return stale(c);
    const req = await hydra.getLogout(challenge);
    const intent = getCookie(c, signOutCookie);
    if (intent && safeEqual(intent, hmac(keys.forms, 'sign-out'))) {
      deleteCookie(c, signOutCookie, { path: '/', secure: config.secureCookies });
      return finishLogout(c, challenge, req.subject, req.sid);
    }
    return page(c, pages.confirmSignOut({ csrf: formToken(c), challenge, product: await productOf(req.client?.client_id) }));
  }));

  app.post('/logout', c => hydraGuard(c, async () => {
    const body = await form(c);
    if (!checkForm(c, body)) return refused(c);
    const challenge = body.logout_challenge;
    if (!isChallenge(challenge)) return stale(c);
    const req = await hydra.getLogout(challenge);
    if (body.action !== 'sign_out') {
      await hydra.rejectLogout(challenge);
      return c.redirect((await signedInAccount(c)) ? '/account' : '/login', 303);
    }
    return finishLogout(c, challenge, req.subject, req.sid);
  }));

  async function finishLogout(c: Context, challenge: string, subject: string, sid: string) {
    await service.endSession(getCookie(c, sessionCookie));
    deleteCookie(c, sessionCookie, { path: '/', secure: config.secureCookies });
    const account = subject ? await service.findById(subject) : null;
    if (account) {
      if (sid) await service.forgetHydraSession(account, sid);
      await service.audit(account.region, account.id, 'sign_out', auditCtx(c));
    }
    return c.redirect(await hydra.acceptLogout(challenge), 303);
  }

  app.get('/signed-out', c => page(c, pages.signedOut()));

  /** Hydra's error page. Its parameters come from the address bar, so only a known code is shown. */
  app.get('/error', c => page(c, pages.problemPage({
    title: 'That sign-in did not work.',
    message: 'Go back to the LotusPond product you were using and try again. If it keeps happening, sign in at accounts.lotuspond.ai first.',
  }), 400));

  /* ---------- development only ---------- */

  if (mailer instanceof Outbox && config.env !== 'production') {
    // The development outbox: what would have been emailed. Never in production (config.ts refuses the outbox there).
    app.get('/dev/outbox.json', c => c.json(mailer.messages));
  }

  app.notFound(c => page(c, pages.problemPage({ title: 'Page not found.', message: 'This address is not part of LotusPond Accounts.' }), 404));
  app.onError((err, c) => {
    // Only the error's type and code: a database error's message can carry query parameters, such as an email.
    const code = (err as { code?: unknown }).code;
    console.error(`An unexpected error stopped a request: ${err.constructor.name}${typeof code === 'string' ? ` (${code})` : ''}.`);
    return c.html(pages.problemPage({ title: 'Something went wrong.', message: 'Try again in a few minutes.' }), 500);
  });

  return app;
}
