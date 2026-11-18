# Deploying LotusPond Accounts

Production is one server in Mumbai (`ap-south-1`), separate from LotusPond Health's, running this folder's stack. Setting up that server is M6 of the build plan and has not been done. This page describes the stack and the local run.

## The stack

| Service | Image | Networks | Published |
| --- | --- | --- | --- |
| `db` | PostgreSQL 16 | data | nothing |
| `hydra-migrate` | Ory Hydra v26.2.0 | data | nothing; applies Hydra's migrations, then exits |
| `hydra` | Ory Hydra v26.2.0 | edge, data, admin (fixed address `172.31.250.2`) | nothing |
| `app` | built from `../Dockerfile` | edge, data, admin | nothing |
| `caddy` | Caddy 2 | edge | 80, 443 |

Every image is pinned by digest.

### Networks

- **edge** carries web traffic: Caddy to the app and to Hydra's public port (4444). Hydra trusts `X-Forwarded-Proto` only from this subnet.
- **data** is internal, with no route to the internet. PostgreSQL is reachable only from Hydra, `hydra-migrate` and the app.
- **admin** is internal. Hydra's admin API (4445) listens only on Hydra's address in this network, and only the app joins it. Caddy cannot reach the admin API by name or by any of Hydra's addresses; `tools/smoke.sh` checks this.

### Databases

`postgres-init.sh` runs once, when the volume is first created. It makes three databases, each owned by its own role, and removes every other role's access:

- `accounts_directory`: an HMAC of each email to its region, and which client belongs to which product. No personal data.
- `accounts_in`: the India account cell.
- `hydra`: Hydra's own store.

The app migrates the directory, then each cell, at start-up, and stops at the first failure. Hydra's migrations run in `hydra-migrate` before Hydra starts.

### Email

Production sends through Amazon SES in `ap-south-1`, from `accounts@lotuspond.ai`. Before it can:

- verify the `lotuspond.ai` domain in SES, with DKIM, SPF and DMARC records;
- move the SES account out of the sandbox;
- create an IAM user allowed only `ses:SendEmail` from that identity, and put its keys in `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` in `deploy/.env`.

None of this has been done yet (M6).

### Registering a product

Consent is accepted only for clients registered as a LotusPond product. Register one from inside the app container, which can reach Hydra's admin API:

```sh
docker compose exec app node dist/clients-cli.js register --product health --client-id lotuspond-health \
  --redirect-uri https://health.lotuspond.ai/api/auth/accounts/callback \
  --post-logout-uri https://health.lotuspond.ai/login \
  --backchannel-logout-uri https://health.lotuspond.ai/api/auth/accounts/backchannel-logout
```

Repeat `--redirect-uri` and `--post-logout-uri` for each regional host. Add `--public` for a client without a secret (PKCE only). A confidential client's secret is printed once; store it in the product's own secrets.

### Secrets

`make-secrets.sh` writes `deploy/.env` with fresh random values and refuses to overwrite an existing file. Losing it locks the databases and invalidates every Hydra token and cookie, so back it up as soon as it exists. Set `ACME_EMAIL` before starting on a server.

## Local run

Plain HTTP at http://localhost:8080, with Hydra in `--dev` mode so its issuer can be `http`:

```sh
./make-secrets.sh
ACME_EMAIL=local@localhost docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait
../tools/smoke.sh
```

`ACME_EMAIL` is required by `docker-compose.yml` but unused locally: Caddy gets no certificate for plain HTTP.

To start again from empty databases: `docker compose -f docker-compose.yml -f docker-compose.local.yml down -v`.
