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
<meta name="referrer" content="no-referrer">
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

export function accountPage(o: Form & { account: Account; products: { product: Product; lastAt: Date }[]; notice?: string; nameProblem?: Problem; passwordProblem?: Problem }): string {
  const a = o.account;
  return layout({
    title: 'Your account',
    body: html`<h1>Your LotusPond account.</h1>
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : null}
<ul class="rows">
<li><span>Email</span><span>${a.email} ${a.emailVerifiedAt ? html`<span class="tag">Confirmed</span>` : html`<span class="tag wait">Not confirmed</span>`}</span></li>
<li><span>Country</span><span>${countryName(a.country)}</span></li>
</ul>
<h2>Name</h2>
<form method="post" action="/account/name" novalidate>
${csrfField(o)}
${input({ name: 'name', label: 'Your name', type: 'text', autocomplete: 'name', value: a.name, problem: o.nameProblem })}
<button class="lp-btn lp-btn--outline" type="submit">Save name</button>
</form>
<h2>Connected products</h2>
${o.products.length
    ? html`<ul class="rows">${o.products.map(p => html`<li><span>${PRODUCT_NAMES[p.product]}</span><span class="hint">Last signed in ${p.lastAt.toISOString().slice(0, 10)}</span></li>`)}</ul>`
    : html`<p class="hint">You have not used this account with a LotusPond product yet.</p>`}
<h2>Password</h2>
<p class="hint">Changing it signs you out of every LotusPond product, everywhere. This page stays signed in.</p>
<form method="post" action="/account/password" novalidate>
${csrfField(o)}
<input type="text" name="username" value="${a.email}" autocomplete="username" hidden>
${input({ name: 'current_password', label: 'Current password', type: 'password', autocomplete: 'current-password', problem: o.passwordProblem?.code === 'wrong_password' ? o.passwordProblem : undefined })}
${input({ name: 'new_password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters.', problem: o.passwordProblem?.code === 'weak_password' ? o.passwordProblem : undefined })}
<button class="lp-btn lp-btn--outline" type="submit">Change password</button>
</form>
<form method="post" action="/account/sign-out">
${csrfField(o)}
<div class="actions"><button class="lp-btn lp-btn--accent" type="submit">Sign out</button></div>
</form>`,
  });
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
