# LotusPond Accounts

The one LotusPond account for LotusPond Health and LotusPond Works, at `accounts.lotuspond.ai`. People sign up and sign in here once; each product signs them in through OpenID Connect and keeps its own session and its own data.

- **Decisions:** [ADR-0001](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/architecture/0001-one-lotuspond-account.md) (one account, single sign-on) and [ADR-0002](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/architecture/0002-account-and-product-databases.md) (separate databases), in the company repository.
- **Build plan:** [Accounts step 1](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/plans/2026-11-17-accounts-step-1.md): India only, Health first.

## Status

**M2 of step 1: sign-up and sign-in work locally.** People can create an account, confirm their email, sign in, reset or change their password and sign out, and LotusPond products sign them in through Hydra with single sign-on. **M3: LotusPond Health signs in with it.** Health's sign-up, sign-in, single sign-on, sign-out and the app's sign-in run end to end against this stack, and a password reset here ends Health's sessions through back-channel logout (`tools/health-e2e.sh`). **M8: turning Health passwords off is rehearsed,** with Health's readiness counts (`docs/cutover.md`). **M7: the switch-over is rehearsed end to end** with Health's own export and link commands, including rollback (`docs/cutover.md`); production waits on its gates. **M6: backups and the restore are built and drilled locally** (`docs/production.md`); production itself, its alarms and the uptime check wait for AWS and the merge. **M5: the app's sign-in and sign-out are proved against Accounts without a phone** (`docs/phones.md`); real phones and the stores wait for staging and the developer accounts. **M4: staging is ready as code, not created.** `docs/staging.md` is the runbook, and `deploy/aws/` holds the CloudFormation for the servers and SES. Nothing exists on AWS yet. It has not been deployed anywhere, and no email has been sent through Amazon SES yet; see [`docs/validation/`](docs/validation/) for what has been checked and where.

What a product gets:

- **Authorization code with PKCE (S256 only).** Hydra refuses `plain` and a missing challenge.
- **ID token claims:** `sub`, `email` and `email_verified` (with the `email` scope), `name` (with `profile`), and always `region`, `amr` and `sid`. A company-managed account will also carry `org`, naming its organisation (ADR-0001, decision 7; the owner confirmed the name on 2026-11-17). Step 1 has no managed accounts, so no token carries it yet.
- **Sign-up:** a product that wants the sign-up page sends `screen_hint=signup`. Hydra refuses OpenID Connect's `prompt=create`.
- **Single sign-on:** a browser signed in once goes straight through, `prompt=none` included.
- **Sign-out:** RP-initiated logout, and back-channel logout to every product when someone signs out, resets or changes their password.
- **Sending people back after sign-out needs `id_token_hint`.** Hydra refuses `post_logout_redirect_uri` without it, and accepts an expired ID token as the hint, so a product keeps each session's ID token for as long as the session.
- **Only LotusPond products.** Consent is accepted only for clients registered with `clients-cli`; anything else gets `access_denied`.

## How it fits together

| Part | What it does |
| --- | --- |
| **Ory Hydra** (v26.2.0, Apache 2.0) | The OpenID Connect provider: `/oauth2/*`, `/userinfo`, `/.well-known/*`. Stores client registrations and consent sessions, never emails or passwords. |
| **The Accounts app** (`src/`, TypeScript, Hono, Drizzle) | Hydra's login and consent app, and every page a person sees. Holds accounts and credentials. |
| **PostgreSQL** | Three databases, each with its own role and no access to the others: `accounts_directory` (an HMAC of each email to its region, no personal data), `accounts_in` (the India account cell) and `hydra`. |
| **Caddy** | HTTPS, and routing: Hydra's public endpoints to Hydra, everything else to the app. |

Hydra's admin API listens only on a private network that the app alone joins; [`deploy/README.md`](deploy/README.md) explains the networks.

## Developing

Node 22.12 or later.

```sh
npm install
npm run check        # typecheck, lint, tests (no database or Docker needed)
```

`npm test` runs every sign-in path against the real schema (in-memory PostgreSQL) with a stand-in for Hydra's admin API. `tools/e2e.sh` runs the protocol end to end against the real Hydra in the local stack.

The whole stack, on plain HTTP at http://localhost:8080:

```sh
deploy/make-secrets.sh
cd deploy && ACME_EMAIL=local@localhost docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait
cd .. && tools/smoke.sh && tools/e2e.sh
```

To run LotusPond Health against it (a `lotuspond-health` checkout with `npm ci` done), add `-f docker-compose.health.yml` when starting the stack, then:

```sh
HEALTH_DIR=../lotuspond-health tools/health-e2e.sh
```

Emails go to an in-memory outbox locally: http://localhost:8080/dev/outbox.json. Production refuses the outbox and sends through Amazon SES.

After a schema change in `src/db/*-schema.ts`, run `npm run db:generate` and review the SQL it writes to `drizzle/`.
