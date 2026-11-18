# Production (build plan M6)

LotusPond Accounts at `accounts.lotuspond.ai`: one 4 GB Lightsail server in Mumbai, Amazon SES out of the sandbox, encrypted nightly backups to S3 in Mumbai, and alerts to the owner.

**M6 is done when** a restore from a production backup has been carried out once, and an alert has reached the owner.

**Status, 18 November 2026:**
- **Nothing is created on AWS.** This environment's AWS credentials were refused (`InvalidClientTokenId`).
- **Backups and the restore** are built and drilled locally (`docs/validation/2026-11-18-m6-local.md`).
- **The uptime check** runs once this repository's default branch has it and `ACCOUNTS_HOSTS` is set.

Do staging first (`docs/staging.md`). Production repeats its steps with `production` in place of `staging`; the differences are below.

## 1. SES

- **The identity** is the shared `lotuspond.ai` one, from staging step 1.
- **The production sender:**

  ```sh
  aws cloudformation deploy --region ap-south-1 --stack-name lotuspond-accounts-ses-production \
    --template-file deploy/aws/ses-sender.cfn.yaml --parameter-overrides Environment=production --capabilities CAPABILITY_NAMED_IAM
  aws iam create-access-key --user-name lotuspond-accounts-ses-production
  ```

- **Leaving the sandbox.** In the SES console for Mumbai, choose "Request production access": transactional mail, `https://lotuspond.ai`, describing confirmation and password-reset emails only. AWS answers within about a day.
  - Leaving the sandbox applies to the whole AWS account in Mumbai, so staging can then email anyone too. Keep staging to test inboxes by habit.
- **DMARC.** Once DMARC reports show only SES and the company's own mail, tighten `_dmarc.lotuspond.ai` from `p=none` to `p=quarantine`.

## 2. The server

```sh
ENVIRONMENT=production DOMAIN=accounts.lotuspond.ai ACME_EMAIL=<ops mailbox> SSH_CIDR=<your IPv4>/32 REF=main \
  bash deploy/aws/create-server.sh
```

- **DNS:** point `accounts.lotuspond.ai` at the printed addresses.
- **`deploy/.env`:** add the SES keys from step 1, and check `SES_CONFIGURATION_SET=lotuspond-accounts-production`.
- **Restart:** `docker compose up -d`.
- **Check from outside:** `tools/staging-check.sh accounts.lotuspond.ai`.

Register Health's production client as in staging step 5, with the `health.lotuspond.ai` addresses for each regional host. Health uses it only from M7, when its `ACCOUNTS_ISSUER` is set.

## 3. Backups

The pattern is LotusPond Health's:

- **Encrypted on the server.** Every file is encrypted with `age` before it leaves the server, and the server holds only the public key.
- **Write-only upload.** The uploading key may only add objects.
- **Kept in India.** The bucket is in Mumbai and versioned, and keeps backups 35 days.

What a backup holds:

- the three databases: `accounts_directory`, `accounts_in`, and `hydra`, which holds the client registrations and signing keys;
- `deploy/.env`, whose secrets open Hydra's keys and the directory.

To set it up:

1. **The age key pair,** made on the owner's own machine, never on the server: `age-keygen -o lotuspond-accounts-backup.key`.
   - Keep the private key offline, in two places.
   - The public key, `age1…`, is printed with `age-keygen -y lotuspond-accounts-backup.key`.
2. **The bucket and its writer:**

   ```sh
   aws cloudformation deploy --region ap-south-1 --stack-name lotuspond-accounts-backups \
     --template-file deploy/aws/backup-bucket.cfn.yaml --capabilities CAPABILITY_NAMED_IAM
   ```

   - Create an access key for `lotuspond-accounts-backup-writer`.
   - Put it in `~/.aws/credentials` for `ubuntu` on the server.
3. **In `deploy/.env`:**
   - `BACKUP_S3_URI`, from the stack output;
   - `BACKUP_AGE_RECIPIENT=age1…`.
4. **On the server:**
   - turn on the nightly timer: `sudo deploy/install-backup.sh`;
   - run one now: `sudo systemctl start lotuspond-accounts-backup`;
   - check `journalctl -u lotuspond-accounts-backup` says "Uploaded".

Lightsail's daily snapshot (22:00 UTC) is the second line: the whole disk, in Mumbai.

## 4. Restoring (and the drill M6 requires)

Restore onto **empty volumes** only: a new server, or a scratch one for the drill. Never onto the live server's data.

1. **Download one night's four `.age` files** from the bucket, with an owner's read access. The server's key cannot read them.
2. **Decrypt them** on a trusted machine:

   ```sh
   for f in *.age; do age -d -i lotuspond-accounts-backup.key -o "${f%.age}" "$f"; done
   ```

3. **Restore.** On the new or scratch server, with the repository at the same ref and no stack running, copy the decrypted files to a folder and run:

   ```sh
   deploy/restore.sh <folder> <stamp>
   ```

   - It puts the backup's `.env` in place, recreates the roles and databases from it, and restores each database as its own role.
   - Then it starts the stack.
4. **Check it,** then delete the decrypted files.
   - After a real loss, the check is `tools/staging-check.sh` against the host.
   - For the drill, on a scratch server: a known person signs in, and the JWKS shows the same `kid` as production's.

`tools/restore-drill.sh` does steps 2 to 4 on a local stack, end to end, as a rehearsal.

**For the M6 drill**, use a scratch Lightsail instance in Mumbai, with no DNS, and delete it after. Record it in `docs/validation/`.

## 5. Alerts

- **Server alarms.** The server's stack holds two Lightsail alarms: status checks failing for 10 minutes, and CPU at or above 90% for 30 minutes. They email the region's contact method. Create that once, then confirm the email Lightsail sends:

  ```sh
  aws lightsail create-contact-method --region ap-south-1 --protocol Email --contact-endpoint <owner mailbox>
  ```

- **The site, from outside.** `.github/workflows/uptime.yml` runs `tools/staging-check.sh` every 15 minutes against the repository variable `ACCOUNTS_HOSTS`, for example `accounts.lotuspond.ai staging.accounts.lotuspond.ai`. A failed run emails whoever last changed its schedule. It runs only on the default branch, so it starts once this work is merged.

**Proving an alert reaches the owner,** which M6 requires:

- **A server alarm:** `aws lightsail test-alarm --region ap-south-1 --alarm-name lotuspond-accounts-production-status-check --state ALARM`. The email should arrive within minutes.
- **The uptime check:** in Actions, run Uptime with `hosts` set to a name that does not resolve, and check that the failure email arrives.

Record both in `docs/validation/`.
