# LotusPond Accounts

The one LotusPond account for LotusPond Health and LotusPond Works, at `accounts.lotuspond.ai`. People sign up and sign in here once; each product signs them in through OpenID Connect and keeps its own session and its own data.

- **Decisions:** [ADR-0001](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/architecture/0001-one-lotuspond-account.md) (one account, single sign-on) and [ADR-0002](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/architecture/0002-account-and-product-databases.md) (separate databases), in the company repository.
- **Build plan:** [Accounts step 1](https://github.com/lotuspond-ai/lotuspond/blob/main/docs/plans/2026-11-17-accounts-step-1.md): India only, Health first.

## Status

**M1 of step 1: the skeleton.** It serves Hydra's OpenID Connect discovery and keys, and a health check. Nobody can sign up or sign in yet: the sign-up, sign-in, email and Hydra login and consent pages are M2. It has not been deployed anywhere; see [`docs/validation/`](docs/validation/) for what has been checked and where.

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

The whole stack, on plain HTTP at http://localhost:8080:

```sh
deploy/make-secrets.sh
cd deploy && ACME_EMAIL=local@localhost docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait
cd .. && tools/smoke.sh
```

After a schema change in `src/db/*-schema.ts`, run `npm run db:generate` and review the SQL it writes to `drizzle/`.
