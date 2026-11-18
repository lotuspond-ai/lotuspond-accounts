# Taken emails at sign-up, and resets of never-confirmed accounts: local checks

Date: 18 November 2026. Where: a cloud container, local only. Nothing deployed.

## What changed

- **Sign-up with an email that already has an account** gets the same answer as a new sign-up:
  - the same status, the same "Confirm your email" page, and a session cookie;
  - that cookie names no session.
  - The owner gets an email, "You already have a LotusPond account", with links to sign in and to reset the password. It counts against the same hourly limit as confirmation emails.
- **A password reset of a never-confirmed account made at sign-up** drops what that sign-up chose:
  - the name goes back to the first part of the address;
  - the terms acceptance is cleared.
  - Accounts made by the Health import have no terms acceptance, so they keep their name.

## What this does not hide

- **Continue and "Send the link again".** After a sign-up with a taken email, these send the browser to sign-in, because the cookie names no session. After a real sign-up they show the page again. So someone who clicks on can still tell the difference.
- **Timing.** A taken email skips the account inserts, so it may answer slightly faster.
- **Country and region.** A reset keeps them. Only India is open, and the region decides which cell holds the account, so changing it would mean moving the account.

## Checks

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 68 passed, 0 failed, including 2 new tests:
  - a taken email gets the same page and cookie, and the owner gets one email;
  - a reset of a confirmed account keeps its name and terms.
- The existing test that a reset confirms the email now also checks that the name and terms are dropped.
- Not run here: `tools/e2e.sh`, `tools/smoke.sh` and the Health job. CI runs them on the pull request.
