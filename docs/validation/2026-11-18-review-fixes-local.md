# Review fixes for PR #1: local checks

Date: 18 November 2026. Where: a cloud container, local only. Nothing deployed.

## What changed

- Sign-up writes its audit record after the account is saved, outside the error path. A failed audit write no longer frees the email of an account that exists.
- A Hydra admin call that cannot connect or times out becomes `HydraError(503)`. People see "Sign-in is not available right now", not the generic error.
- The per-email sign-in limit counts email and address together. A password change has its own limit per account. Someone elsewhere can no longer lock a person out.
- Forgot-password answers before it looks the email up, so its timing says nothing about the address.
- Sign-in and forgot-password use `normaliseEmail`.
- One `productForChallenge` helper replaces five copies.
- The fonts are read once at start-up.
- `findById` asks every cell at once.

## Not changed, and why

- Sign-up still says when an email is taken. Changing that changes what people see and what is emailed, so it needs the owner's decision.
- A reset of a never-confirmed account keeps the name and country given at sign-up. Asking for them again is a new page, so it needs the owner's decision too.

## Checks

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 66 passed, 0 failed.
- Not run here: `tools/e2e.sh`, `tools/smoke.sh` and the Health job. CI runs them on the pull request.
