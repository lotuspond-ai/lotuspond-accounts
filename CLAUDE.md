# LotusPond Accounts engineering guide

LotusPond Accounts is the one account for LotusPond Health and LotusPond Works. It signs people in and holds identity only: email, credentials, name, country and home region. It never holds health records or Works data, and it never tells one product whether a person uses the other. The decisions are ADR-0001 and ADR-0002, and the current work is the step 1 build plan, all in `lotuspond-ai/lotuspond` (`docs/architecture/`, `docs/plans/`). Build nothing those documents do not call for; when they are silent, ask.

## Structure

- `src/` is the Accounts app: Hono, Drizzle, PostgreSQL. `src/db/directory-schema.ts` is the global directory; `src/db/cell-schema.ts` is one region's account cell, the same schema in every cell.
- `drizzle/directory` and `drizzle/cell` are generated SQL migrations. Generate them with `npm run db:generate`; never edit an applied migration.
- `deploy/` is the production stack (PostgreSQL, Ory Hydra, the app, Caddy) and its local variant.
- `src/app.ts` is Hydra's login, consent and logout app and every page; `src/accounts.ts` is the account logic; `src/views/` draws the pages in the LotusPond design system from `design/tokens.json`.
- `test/` runs every path against the real schema with a stand-in Hydra; `test-e2e/` (via `tools/e2e.sh`) runs the protocol against the real Hydra.
- `tools/smoke.sh` checks a running local stack; CI runs it and the end-to-end tests on every pull request.
- `docs/validation/` records what was checked, where and when.
- `placeholder/` is the static page at accounts.lotuspond.ai until Accounts is deployed there.

## Rules

- **Separate databases.** The directory, each cell and Hydra each have their own database and role. No code reads across them. A cell's personal data never leaves its region. The directory stores only an HMAC of the email.
- **Hydra's admin API is never published.** It listens only on Hydra's fixed address on the private `admin` network, which only the app joins. `test/deploy.test.ts` holds this; keep it passing rather than editing it.
- **Hydra stays a pinned, unmodified upstream image,** pinned by digest, with telemetry off (`--sqa-opt-out`) and `--dev` only in `docker-compose.local.yml`. Upgrade it on purpose, read its changelog for breaking changes, and run its migrations through `hydra-migrate`.
- **Secrets come from `deploy/.env`** (made by `deploy/make-secrets.sh`), never from a committed file. No password, token, cookie, ID token or email address in plain text appears in a log, an error response or the audit table.
- **Errors tell people what to do, not why the server failed.** Public errors carry a code and a plain message; internal details stay internal.
- **Every third-party image and base image is pinned by digest.**
- **Consent is only for LotusPond's own products,** registered with `clients-cli`. Never add a consent screen for outside applications without a decision recorded in the company repository.
- **Pages carry no inline style or script;** the content security policy blocks them. Colours come from `design/tokens.json`, copied from the company design system.

## Checks

Run `npm run check` for every change. For a change to `deploy/`, also bring the local stack up and run `tools/smoke.sh`. Record local, CI and deployed evidence separately in `docs/validation/`. A configured service is not a verified one, and a passing build is not a deployment.

## Writing

The products are LotusPond Health and LotusPond Works; this service is LotusPond Accounts. Code, packages, databases and environment variables use the `lotuspond` identifier. Write documentation in short, plain sentences.
