# Staging (build plan M4)

Staging is two small servers in Mumbai, LotusPond Accounts at `staging.accounts.lotuspond.ai` and LotusPond Health at `staging.health.lotuspond.ai`, sending real email through Amazon SES in its sandbox. The owner settled these on 18 November 2026:

- **Synthetic accounts only.** No production account, email or record is ever copied to staging. The account import is rehearsed with a generated file in Health's export format.
- **SES sandbox.** Email reaches only addresses verified in SES: a few test inboxes.
- **Two small servers**, one per product, as in production.
- **Hostnames** `staging.accounts.lotuspond.ai` and `staging.health.lotuspond.ai`.

**Status:** everything below exists as code and has run locally (`docs/validation/2026-11-18-m4-local.md`). **Nothing has been created on AWS yet.** The AWS credentials this work was done with were refused by AWS (`InvalidClientTokenId`).

## What it costs

- Two Lightsail 2 GB plans in Mumbai (`small_3_1`), each about $12 a month. Check the [Lightsail pricing page](https://aws.amazon.com/lightsail/pricing/).
- Daily snapshots, a few cents each.
- SES, a few cents per thousand messages.

To remove staging entirely, delete the stacks `lotuspond-accounts-staging-in` and `lotuspond-accounts-ses-staging`, and Health's staging instance.

## What the operator needs

- **The AWS CLI**, signed in to LotusPond's account, with permission for:
  - CloudFormation and Lightsail in `ap-south-1`;
  - SES in `ap-south-1`;
  - IAM, to create the send-only user and its access key.
- **Access to the `lotuspond.ai` DNS.** The company site runs on Cloudflare, so the zone is most likely there; check before starting.
- **Your current public IPv4 address**, for SSH (`SSH_CIDR`, as `a.b.c.d/32`).

## 1. SES: the sending identity (once, shared with production)

```sh
aws cloudformation deploy --region ap-south-1 --stack-name lotuspond-ses-identity \
  --template-file deploy/aws/ses-identity.cfn.yaml
aws cloudformation describe-stacks --region ap-south-1 --stack-name lotuspond-ses-identity --query 'Stacks[0].Outputs' --output table
```

Add these DNS records:

| Name | Type | Value |
| --- | --- | --- |
| The three `DkimRecord` outputs | CNAME | As printed. Turn Cloudflare's proxy off for them. |
| `mail.lotuspond.ai` | MX | `10 feedback-smtp.ap-south-1.amazonses.com` |
| `mail.lotuspond.ai` | TXT | `v=spf1 include:amazonses.com ~all` |
| `_dmarc.lotuspond.ai` | TXT | `v=DMARC1; p=none; rua=mailto:<a mailbox you read>`. Only if there is none yet. Tighten to `quarantine` once reports are clean. |

SES shows the identity as verified once DKIM resolves, usually within an hour.

## 2. SES: the staging sender

```sh
aws cloudformation deploy --region ap-south-1 --stack-name lotuspond-accounts-ses-staging \
  --template-file deploy/aws/ses-sender.cfn.yaml --parameter-overrides Environment=staging --capabilities CAPABILITY_NAMED_IAM
aws iam create-access-key --user-name lotuspond-accounts-ses-staging
```

- The access key is shown once. It goes into the staging server's `deploy/.env` (step 4), and nowhere else: not in a chat, a ticket or this repository.
- The user may only call `ses:SendEmail` from `accounts@lotuspond.ai`.

**Sandbox recipients.** Verify each test inbox, then open the link SES sends to it:

```sh
aws sesv2 create-email-identity --region ap-south-1 --email-identity <test inbox>
```

## 3. The Accounts staging server

It builds from `main` unless `REF` names another branch.

```sh
ENVIRONMENT=staging DOMAIN=staging.accounts.lotuspond.ai ACME_EMAIL=<ops mailbox> SSH_CIDR=<your IPv4>/32 REF=main \
  bash deploy/aws/create-server.sh
```

- **DNS:** point `staging.accounts.lotuspond.ai` at the printed static IP (A) and IPv6 address (AAAA). In Cloudflare, start with the proxy off (DNS only), so Caddy can get its certificate.
- **What the server does on first boot:** it clones the repository, makes `deploy/.env` with fresh secrets, and starts the stack. Its log is `/var/log/lotuspond-firstboot.log`.

## 4. Finish the Accounts server

SSH in as `ubuntu`, then edit `/opt/lotuspond-accounts/deploy/.env`:

- set `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` from step 2;
- check `DOMAIN`, `MAIL_FROM` and `SES_CONFIGURATION_SET=lotuspond-accounts-staging`.

Then restart and check it:

```sh
cd /opt/lotuspond-accounts/deploy && docker compose up -d
```

From your own machine:

```sh
tools/staging-check.sh staging.accounts.lotuspond.ai
```

Back up `deploy/.env` somewhere safe: losing it locks the databases.

## 5. Register Health staging at Accounts

On the Accounts server:

```sh
docker compose exec app node dist/clients-cli.js register --product health --client-id lotuspond-health-staging \
  --redirect-uri https://staging.health.lotuspond.ai/api/auth/accounts/callback \
  --post-logout-uri https://staging.health.lotuspond.ai/login \
  --post-logout-uri https://staging.health.lotuspond.ai/api/auth/accounts/signed-out \
  --backchannel-logout-uri https://staging.health.lotuspond.ai/api/auth/accounts/backchannel-logout
```

The client secret is printed once; it goes into Health staging's `deploy/.env` only.

## 6. The Health staging server

Follow Health's own "Set up staging" in `lotuspond-ai/lotuspond-health` `deploy/ci-cd.md`: `NAME=lotuspond-health-staging` with `aws-lightsail-create.sh`, its own `deploy/.env`, and `DOMAIN=staging.health.lotuspond.ai`. Then add to that `.env`:

```
ACCOUNTS_ISSUER=https://staging.accounts.lotuspond.ai
ACCOUNTS_CLIENT_ID=lotuspond-health-staging
ACCOUNTS_CLIENT_SECRET=<from step 5>
```

Health staging must run code that includes `lotuspond-health#40` and `#48`, both merged into Health's `main` on 18 November 2026. Health's staging deploys its `development` branch. Creating that branch, and what goes on it, is the Health owner's decision.

## 7. Synthetic data, and the import rehearsal

Never copy production data. Instead:

1. **Health accounts with passwords.** On Health staging, create a few through its own sign-up, with addresses you control or `@example.com` ones.
2. **Export them** on Health staging: `docker compose exec app node dist/index.js accounts:export /tmp/export.jsonl`.
3. **Import them** on the Accounts server. Stream the file in, so it belongs to the app's user, then stream the answer out:

   ```sh
   docker compose exec -T app sh -c 'umask 077 && cat > /tmp/export.jsonl' < export.jsonl
   docker compose exec -T app node dist/accounts-cli.js import /tmp/export.jsonl /tmp/answer.jsonl
   docker compose exec -T app cat /tmp/answer.jsonl > answer.jsonl
   ```

4. **Link them** on Health staging: `accounts:link answer.jsonl`.
5. **Delete** both files on both servers and on your machine.

For load or larger rehearsals, `npx tsx tools/synthetic-health-export.ts <count> <file>` writes a made-up export, with `@example.com` addresses and one shared test password.

## 8. Check it works on staging

Use a verified test inbox:

- [ ] Health's "Create account" opens Accounts' sign-up. The confirmation email arrives, from `accounts@lotuspond.ai` and DKIM-signed. Confirming finishes on Health.
- [ ] Sign out of Health. It returns to Health's sign-in page, and Accounts asks for the password again.
- [ ] Sign in again, then use another Health tab: there is no second sign-in.
- [ ] An AI agent's connection to Health staging (`/oauth/authorize`) signs in silently when Accounts already has a session.
- [ ] Reset the password at Accounts. Health's session in another browser ends by itself (back-channel logout).
- [ ] An imported account (step 7) signs in with its old password, confirms its email, and lands in its own Health account.
- [ ] `tools/staging-check.sh` passes for `staging.accounts.lotuspond.ai`.

Record the results in `docs/validation/`, separately from local and CI evidence.
