// Every page a person sees at accounts.lotuspond.ai. One sheet on the sage field, the wordmark, one main action.
// Words follow the product's voice: short, plain, and saying what to do next.
import type { Account, Problem, Product } from '../accounts.ts';
import { COUNTRY_CODES, countryName } from '../lib/countries.ts';
import { html, type Html } from './html.ts';

export const PRODUCT_NAMES: Record<Product, string> = { health: 'LotusPond Health', works: 'LotusPond Works' };

interface Layout { title: string; body: Html }

export function layout({ title, body }: Layout): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="same-origin">
<title>${title} · LotusPond</title>
<link rel="stylesheet" href="/assets/accounts.css">
</head>
<body>
<header class="top"><a class="lp-wordmark" href="/account" aria-label="LotusPond account">LotusPond<i aria-hidden="true"></i></a></header>
<main><div class="sheet">${body}</div></main>
<footer>LotusPond Accounts signs you in to LotusPond Health and LotusPond Works. It keeps your email, name, country and password, and nothing else.</footer>
</body>
</html>`.value;
}

/* ---------- pieces ---------- */

export interface Form { csrf: string }

const csrfField = (f: Form) => html`<input type="hidden" name="csrf" value="${f.csrf}">`;
const challengeField = (challenge?: string) => (challenge ? html`<input type="hidden" name="login_challenge" value="${challenge}">` : null);
const withChallenge = (path: string, challenge?: string) => (challenge ? `${path}?login_challenge=${encodeURIComponent(challenge)}` : path);

function problemFor(problems: Problem[], field: Problem['field']): Problem | undefined {
  return problems.find(p => p.field === field);
}

function input(o: { name: string; label: string; type: string; autocomplete: string; value?: string; problem?: Problem; hint?: string; required?: boolean; autofocus?: boolean }): Html {
  const id = `f-${o.name}`;
  const described = [o.hint ? `${id}-hint` : '', o.problem ? `${id}-error` : ''].filter(Boolean).join(' ');
  return html`<div class="field">
<label for="${id}">${o.label}</label>
${o.hint ? html`<span class="hint" id="${id}-hint">${o.hint}</span>` : null}
${o.problem ? html`<p class="error" id="${id}-error">${o.problem.message}</p>` : null}
<input id="${id}" name="${o.name}" type="${o.type}" autocomplete="${o.autocomplete}"${o.value ? html` value="${o.value}"` : null}${o.required === false ? null : html` required`}${o.problem ? html` aria-invalid="true"` : null}${described ? html` aria-describedby="${described}"` : null}${o.autofocus ? html` autofocus` : null}>
</div>`;
}

function formProblem(problems: Problem[]): Html | null {
  const p = problemFor(problems, 'form');
  return p ? html`<p class="notice danger" role="alert">${p.message}</p>` : null;
}

const continueTo = (product: Product | null) => (product ? html` to continue to ${PRODUCT_NAMES[product]}` : null);

/* ---------- sign-in and sign-up ---------- */

export function signIn(o: Form & { challenge?: string; product: Product | null; email?: string; problems?: Problem[]; notice?: string }): string {
  const problems = o.problems ?? [];
  return layout({
    title: 'Sign in',
    body: html`<h1>Sign in.</h1>
<p class="lede">Use your LotusPond account${continueTo(o.product)}.</p>
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : null}
${formProblem(problems)}
<form method="post" action="/login" novalidate>
${csrfField(o)}${challengeField(o.challenge)}
${input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'username', value: o.email, autofocus: !o.email })}
${input({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', autofocus: !!o.email })}
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Sign in</button><a href="/forgot-password">Forgot your password?</a></div>
</form>
<h2>New to LotusPond?</h2>
<p><a href="${withChallenge('/signup', o.challenge)}">Create a LotusPond account</a>. One account works for LotusPond Health and LotusPond Works.</p>`,
  });
}

export function signUp(o: Form & { challenge?: string; product: Product | null; values?: Partial<Record<'email' | 'name' | 'country', string>>; problems?: Problem[]; openCountries: readonly string[] }): string {
  const problems = o.problems ?? [];
  const v = o.values ?? {};
  const countryProblem = problemFor(problems, 'country');
  const termsProblem = problemFor(problems, 'acceptTerms');
  const options = [...COUNTRY_CODES].map(code => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return layout({
    title: 'Create your account',
    body: html`<h1>Create your LotusPond account.</h1>
<p class="lede">One account ${o.product ? html`for ${PRODUCT_NAMES[o.product]} and the rest of LotusPond` : html`for LotusPond Health and LotusPond Works`}. We ask only for what an account needs.</p>
${formProblem(problems)}
<form method="post" action="/signup" novalidate>
${csrfField(o)}${challengeField(o.challenge)}
${input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', value: v.email, problem: problemFor(problems, 'email'), autofocus: true })}
${input({ name: 'name', label: 'Your name', type: 'text', autocomplete: 'name', value: v.name, problem: problemFor(problems, 'name') })}
${input({ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', problem: problemFor(problems, 'password'), hint: 'At least 10 characters. A few words you will remember is a good password.' })}
<div class="field">
<label for="f-country">Country you live in</label>
<span class="hint" id="f-country-hint">It decides where your account is stored. Accounts are open to people living in India first.</span>
${countryProblem ? html`<p class="error" id="f-country-error">${countryProblem.message}</p>` : null}
<select id="f-country" name="country" autocomplete="country" required aria-describedby="f-country-hint${countryProblem ? ' f-country-error' : ''}"${countryProblem ? html` aria-invalid="true"` : null}>
<option value="">Choose a country</option>
${options.map(c => html`<option value="${c.code}"${(v.country ?? (o.openCountries.length === 1 ? o.openCountries[0] : '')) === c.code ? html` selected` : null}>${c.name}</option>`)}
</select>
</div>
${termsProblem ? html`<p class="error" id="f-terms-error">${termsProblem.message}</p>` : null}
<div class="check"><input id="f-terms" type="checkbox" name="accept_terms" value="yes" required${termsProblem ? html` aria-invalid="true" aria-describedby="f-terms-error"` : null}><label for="f-terms">I agree to the LotusPond account terms. They cover this account only; each product asks for its own agreement.</label></div>
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Create account</button></div>
</form>
<p class="after">Already have an account? <a href="${withChallenge('/login', o.challenge)}">Sign in</a>.</p>`,
  });
}

/** After sign-up, or a sign-in with an unconfirmed email: confirm it, then continue. */
export function checkEmail(o: Form & { email: string; challenge?: string; product: Product | null; notice?: string; problem?: string }): string {
  return layout({
    title: 'Confirm your email',
    body: html`<h1>Confirm your email.</h1>
<p class="lede">We sent a link to <strong>${o.email}</strong>. Open it and confirm, then come back here and choose Continue.</p>
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : null}
${o.problem ? html`<p class="notice danger" role="alert">${o.problem}</p>` : null}
<form method="post" action="/login/continue">
${csrfField(o)}${challengeField(o.challenge)}
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Continue${o.product ? html` to ${PRODUCT_NAMES[o.product]}` : null}</button></div>
</form>
<h2>No email?</h2>
<p>Check your spam folder. The link works for 24 hours.</p>
<form method="post" action="/verify-email/resend">
${csrfField(o)}${challengeField(o.challenge)}
<button class="lp-btn lp-btn--outline" type="submit">Send the link again</button>
</form>`,
  });
}

/* ---------- email links ---------- */

export function confirmEmail(o: Form & { token: string }): string {
  return layout({
    title: 'Confirm your email',
    body: html`<h1>Confirm your email.</h1>
<p class="lede">Confirm that this email address belongs to you.</p>
<form method="post" action="/verify-email">
${csrfField(o)}<input type="hidden" name="token" value="${o.token}">
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Confirm my email</button></div>
</form>`,
  });
}

export function emailConfirmed(): string {
  return layout({
    title: 'Email confirmed',
    body: html`<h1>Email confirmed.</h1>
<p class="lede">Go back to the page where you were signing in and choose Continue. You can close this one.</p>
<p><a href="/account">Go to your account</a></p>`,
  });
}

export function linkExpired(o: { what: 'confirm' | 'reset' }): string {
  return layout({
    title: 'Link expired',
    body: html`<h1>This link no longer works.</h1>
<p class="lede">It was already used, or it expired. ${o.what === 'confirm' ? 'Sign in and we will send a new one.' : 'Ask for a new one.'}</p>
<div class="actions"><a class="lp-btn lp-btn--accent" href="${o.what === 'confirm' ? '/login' : '/forgot-password'}">${o.what === 'confirm' ? 'Sign in' : 'Reset my password'}</a></div>`,
  });
}

/* ---------- passwords ---------- */

export function forgotPassword(o: Form & { email?: string; problem?: string }): string {
  return layout({
    title: 'Reset your password',
    body: html`<h1>Reset your password.</h1>
<p class="lede">Enter your account's email. We will send a link to choose a new password.</p>
${o.problem ? html`<p class="notice danger" role="alert">${o.problem}</p>` : null}
<form method="post" action="/forgot-password" novalidate>
${csrfField(o)}
${input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'username', value: o.email, autofocus: true })}
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Send the link</button><a href="/login">Back to sign in</a></div>
</form>`,
  });
}

export function resetSent(): string {
  return layout({
    title: 'Check your email',
    body: html`<h1>Check your email.</h1>
<p class="lede">If there is a LotusPond account for that address, we have sent it a link. It works once, for 30 minutes.</p>
<p><a href="/login">Back to sign in</a></p>`,
  });
}

export function resetForm(o: Form & { token: string; problem?: Problem }): string {
  return layout({
    title: 'Choose a new password',
    body: html`<h1>Choose a new password.</h1>
<p class="lede">This signs you out everywhere, in every LotusPond product.</p>
<form method="post" action="/reset-password" novalidate>
${csrfField(o)}<input type="hidden" name="token" value="${o.token}">
${input({ name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', problem: o.problem, hint: 'At least 10 characters.', autofocus: true })}
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Save the new password</button></div>
</form>`,
  });
}

export function resetDone(): string {
  return layout({
    title: 'Password changed',
    body: html`<h1>Password changed.</h1>
<p class="lede">You are signed out everywhere. Sign in again with your new password.</p>
<div class="actions"><a class="lp-btn lp-btn--accent" href="/login">Sign in</a></div>`,
  });
}

/* ---------- the account ---------- */

/** One LotusPond product on the account page: whether it signs in with this account yet, and this person's use of it. */
export interface ProductCard { product: Product; url: string | null; live: boolean; firstAt: Date | null; lastAt: Date | null }

/** Each product in its own words (Health's sign-in page; Works' README). */
const PRODUCT_LINES: Record<Product, string> = {
  health: 'Your family’s health records, ready for any AI agent.',
  works: 'AI-agent workflows inside a company’s real processes, with a person deciding each consequential action.',
};

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function productCard(p: ProductCard): Html {
  const name = PRODUCT_NAMES[p.product];
  const used = !!p.firstAt;
  // Every status is a word; colour only repeats it (design system: never tell two states apart by colour alone).
  const status = used ? html`<span class="tag">Connected</span>`
    : p.live ? html`<span class="tag wait">Not used yet</span>`
      : html`<span class="tag wait">Not available yet</span>`;
  return html`<li class="product" aria-labelledby="product-${p.product}">
<div class="product__head"><h3 id="product-${p.product}">${name}</h3>${status}</div>
<p class="product__line">${PRODUCT_LINES[p.product]}</p>
${used ? html`<dl class="product__facts">
<div><dt>First used</dt><dd>${day.format(p.firstAt!)}</dd></div>
<div><dt>Last signed in</dt><dd>${day.format(p.lastAt!)}</dd></div>
</dl>` : html`<p class="hint">${p.live ? html`Sign in to ${name} with this account to start using it.` : html`${name} does not sign in with this account yet.`}</p>`}
${p.live && p.url ? html`<a class="product__open" href="${p.url}">Open ${name}<span aria-hidden="true"> →</span></a>` : null}
</li>`;
}

export type AccountView = 'products' | 'profile' | 'security';

const ICONS: Record<AccountView, Html> = {
  products: html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>`,
  profile: html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/></svg>`,
  security: html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>`,
};
const VIEWS: { view: AccountView; label: string; href: string }[] = [
  { view: 'products', label: 'Products', href: '/account' },
  { view: 'profile', label: 'Profile', href: '/account/profile' },
  { view: 'security', label: 'Security', href: '/account/security' },
];

/** The signed-in console: a tinted frame with navigation, and the work on an inset panel (design system, product screens). */
function consoleLayout(o: Form & { title: string; view: AccountView; account: Account; body: Html }): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="same-origin">
<title>${o.title} · LotusPond account</title>
<link rel="stylesheet" href="/assets/accounts.css">
</head>
<body class="console">
<div class="frame">
<header class="bar">
<a class="lp-wordmark" href="/account" aria-label="LotusPond account, products">LotusPond<i aria-hidden="true"></i><b>Account</b></a>
<div class="bar__who">
<span class="bar__email">${o.account.email}</span>
<form method="post" action="/account/sign-out">${csrfField(o)}<button class="lp-btn lp-btn--outline lp-btn--sm" type="submit">Sign out</button></form>
</div>
</header>
<nav class="nav" aria-label="Your account">
<ul>${VIEWS.map(v => html`<li><a href="${v.href}"${v.view === o.view ? html` aria-current="page"` : null}>${ICONS[v.view]}<span>${v.label}</span></a></li>`)}</ul>
</nav>
<main class="panel">${o.body}</main>
</div>
</body>
</html>`.value;
}

const confirmedTag = (a: Account) => (a.emailVerifiedAt ? html`<span class="tag">Confirmed</span>` : html`<span class="tag wait">Not confirmed</span>`);

export function accountView(o: Form & { view: AccountView; account: Account; products: ProductCard[]; notice?: string; nameProblem?: Problem; passwordProblem?: Problem }): string {
  const a = o.account;
  const notice = o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : null;
  if (o.view === 'profile') {
    return consoleLayout({ ...o, title: 'Profile', body: html`<h1 class="screen-title">Profile</h1>
<p class="screen-lede">What your LotusPond account holds about you. Products you use receive your email, name and region.</p>
${notice}
<ul class="rows">
<li><span>Email</span><span>${a.email} ${confirmedTag(a)}</span></li>
<li><span>Country</span><span>${countryName(a.country)}</span></li>
</ul>
<form class="form" method="post" action="/account/name" novalidate>
${csrfField(o)}
${input({ name: 'name', label: 'Your name', type: 'text', autocomplete: 'name', value: a.name, problem: o.nameProblem })}
<button class="lp-btn lp-btn--brand" type="submit">Save name</button>
</form>` });
  }
  if (o.view === 'security') {
    return consoleLayout({ ...o, title: 'Security', body: html`<h1 class="screen-title">Security</h1>
<p class="screen-lede">Changing your password signs you out of every LotusPond product, everywhere. This browser stays signed in.</p>
${notice}
<form class="form" method="post" action="/account/password" novalidate>
${csrfField(o)}
<input type="text" name="username" value="${a.email}" autocomplete="username" hidden>
${input({ name: 'current_password', label: 'Current password', type: 'password', autocomplete: 'current-password', problem: o.passwordProblem?.code === 'wrong_password' ? o.passwordProblem : undefined })}
${input({ name: 'new_password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters.', problem: o.passwordProblem?.code === 'weak_password' ? o.passwordProblem : undefined })}
<button class="lp-btn lp-btn--brand" type="submit">Change password</button>
</form>` });
  }
  const connected = o.products.filter(p => p.firstAt).length;
  return consoleLayout({ ...o, title: 'Products', body: html`<h1 class="screen-title">Products</h1>
<p class="screen-lede">Signed in as ${a.name}. ${connected ? html`Connected to ${connected === 1 ? 'one product' : `${connected} products`}.` : html`Not connected to a product yet.`} One account signs you in to every LotusPond product.</p>
${notice}
<ul class="products">${o.products.map(productCard)}</ul>
<p class="hint">A product you use receives your email, your name and the region that holds your account. Your records stay in the product: this account never sees them, and no product learns which other products you use.</p>` });
}

/* ---------- signing out ---------- */

export function confirmSignOut(o: Form & { challenge: string; product: Product | null }): string {
  return layout({
    title: 'Sign out',
    body: html`<h1>Sign out of LotusPond?</h1>
<p class="lede">${o.product ? html`${PRODUCT_NAMES[o.product]} asked to sign you out. ` : null}This signs you out of your LotusPond account and of every LotusPond product signed in with it in this browser.</p>
<form method="post" action="/logout">
${csrfField(o)}<input type="hidden" name="logout_challenge" value="${o.challenge}">
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit" name="action" value="sign_out">Sign out</button><button class="lp-btn lp-btn--outline" type="submit" name="action" value="stay">Stay signed in</button></div>
</form>`,
  });
}

export function signedOut(): string {
  return layout({
    title: 'Signed out',
    body: html`<h1>You are signed out.</h1>
<p class="lede">You can close this page.</p>
<div class="actions"><a class="lp-btn lp-btn--accent" href="/login">Sign in again</a></div>`,
  });
}

/* ---------- problems ---------- */

export function problemPage(o: { title: string; message: string; status?: number }): string {
  return layout({
    title: o.title,
    body: html`<h1>${o.title}</h1>
<p class="lede">${o.message}</p>
<p><a href="/account">Go to your account</a></p>`,
  });
}
