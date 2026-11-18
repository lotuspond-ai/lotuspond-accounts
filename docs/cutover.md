# The switch-over (build plan M7)

LotusPond Health's existing accounts move into LotusPond Accounts, and Health turns on "Continue with LotusPond Account". Health passwords keep working alongside it (the plan's `both` stage) until a later, separate step turns them off (M8).

**M7 is done when:**
- the privacy review is done;
- the production import is checked;
- the first sign-ins link correctly;
- failed sign-ins have been watched for a week.

**Status, 18 November 2026:** rehearsed end to end with synthetic people, locally and in CI (`tools/cutover-rehearsal.sh`; `docs/validation/2026-11-18-m7-local.md`). Not run on production; the gates below are open.

## Gates: all must be true before starting

- [ ] **The privacy review is done.** The privacy policy, the consumer health data policy, and the sign-up consent text cover Accounts processing account data (Health `docs/identity.md`, "Before launch").
- [ ] **Health is ready.** `lotuspond-health` #40 and #48 are merged and deployed to production, with `ACCOUNTS_ISSUER` still unset, so nothing has changed for anyone yet.
- [ ] **Production Accounts is live** (M6): the restore drill is done, and an alert has reached the owner.
- [ ] **Staging passed** the M4 checklist (`docs/staging.md`, step 8), including the import rehearsal with Health's own commands.
- [ ] **SES is out of the sandbox,** and a confirmation email from production has arrived in a real inbox.
- [ ] **Health's production client is registered** at Accounts (`docs/production.md`, step 2).
- [ ] **The apps.** Builds with the Accounts sign-in are in the stores (M5), or the owner has chosen to switch the website first. Older apps keep working with Health passwords during `both`.
- [ ] **The password decision below is made.**

### Decision: Health's old password after a person moves

The rehearsal shows what happens today. Health (#40) keeps a person's Health password hash after they first sign in with Accounts, until a reviewed migration removes it (M9). So:

- **During `both`:** a moved person can still sign in to Health with their *old* Health password, even after changing or resetting their password at Accounts.
- **On rollback:** the same thing. The old Health password opens Health again, and the new Accounts password does not.

That means a password someone changed because it leaked still opens Health until M9. The build plan proposed clearing Health's hash at the person's first Accounts sign-in. That closes the gap, at the cost of a rollback that sends moved people through Health's password reset. **Choose one before the switch-over.**

## The sequence

No downtime is needed: Health's export runs against its live database. Someone who registers with Health between the export and the switch is not imported; they are joined by verified email at their first Accounts sign-in, as the owner settled on 17 November 2026.

1. **Back up both,** and check the backups exist.
   - Health: `deploy/backup.sh`.
   - Accounts: `deploy/backup.sh`.
2. **Export on each Health host:**

   ```sh
   docker compose exec -T app node dist/index.js accounts:export /tmp/export.jsonl
   docker compose exec -T app cat /tmp/export.jsonl > export.jsonl
   ```

   - Note the count Health prints.
   - The file holds emails and password hashes. Move it from server to server inside India (both are in Mumbai), for example with `scp` run on one server. It should not pass through a laptop elsewhere.
3. **Import on the Accounts server:**

   ```sh
   docker compose exec -T app sh -c 'umask 077 && cat > /tmp/export.jsonl' < export.jsonl
   docker compose exec -T app node dist/accounts-cli.js import /tmp/export.jsonl /tmp/answer.jsonl
   docker compose exec -T app cat /tmp/answer.jsonl > answer.jsonl
   ```

   **Check it.** "Created" plus "already imported" plus "already linked" plus "skipped" must equal Health's count. Read every skipped line's reason: none should be unexpected.
4. **Link on each Health host:** copy `answer.jsonl` back and run `node dist/index.js accounts:link <file>` in the app container.
   - "linked" should equal the answers.
   - Conflicts and "not on this server" are listed. Each needs a look before going on.
5. **Delete the files** `export.jsonl` and `answer.jsonl` on every server and machine, inside the containers too.
6. **Switch on.** In Health production's `deploy/.env`, set:
   - `ACCOUNTS_ISSUER=https://accounts.lotuspond.ai`;
   - `ACCOUNTS_CLIENT_ID`;
   - `ACCOUNTS_CLIENT_SECRET`.

   Leave `PASSWORD_SIGN_IN` unset, so passwords stay on. Then run `docker compose up -d`.
7. **First sign-ins,** at once, with real accounts the team controls:
   - [ ] a moved account signs in through Accounts, confirms its email, and lands in its own Health account, with its records;
   - [ ] a new person signs up through Accounts and gets a new Health account;
   - [ ] a Health password still works for an account that has not moved;
   - [ ] signing out of Health returns to Health's sign-in page, signed out at Accounts too.

## The week of watching

Once a day for seven days, on the Accounts server:

```sh
docker compose exec -T app node dist/accounts-cli.js report 1
```

It prints, with counts only and no emails:
- sign-ins, failed sign-ins, new accounts, confirmed emails and password resets per day;
- how many imported people have confirmed their email and signed in to Health.

Read it with Health's logs, and `journalctl` on both servers.

- **Failed sign-ins** count only attempts for an email that has an account; an unknown email is not recorded per account. A rising failure rate, a run of password resets, or imported people who sign in but never reach Health are reasons to stop and look.
- **Rollback triggers:** moved people cannot reach their own records; sign-in fails for everyone; or Accounts is down beyond what the M6 alerts and restore cover.

## Rollback

On Health production, unset `ACCOUNTS_ISSUER` (and the client settings) in `deploy/.env`, then `docker compose up -d`. Accounts keeps everything, so switching on again later needs no new import. From the rehearsal:

- **People who never moved:** unaffected.
- **Moved people:** sign in with their *old Health password* (see the decision above).
- **People who signed up through Accounts after the switch:** they have no Health password and **cannot sign in to Health** until Accounts sign-in is back. Keep a rollback short, and tell them.

## After the week

Record the week's reports in `docs/validation/`.
- **M8** (`PASSWORD_SIGN_IN=off` on Health) follows once most active app installs run the Accounts sign-in.
- **M9** drops Health's `password_hash` and directory, in its own reviewed migration.
