# Phones and stores (build plan M5)

The iPhone and Android apps are LotusPond Health's. Their sign-in with LotusPond Accounts is built in `lotuspond-ai/lotuspond-health` PRs #40 and #48. This page is the Accounts side of M5: what to check on a real phone against staging, and what has already been proved without one.

**Status, 18 November 2026:** not run on a phone. That needs staging (M4, waiting on AWS credentials), real devices, a Mac with Xcode, and the Apple and Google developer accounts. No folder on the owner's Mac was available to this cloud session.

## Already proved without a phone

Against the real Accounts and Hydra, through Health's own endpoints, as the app calls them (`test-e2e/health.test.ts`):

- **Sign-in:** the system browser signs up at Accounts. Health hands a one-time code back to the app on `ai.lotuspond.health:/accounts`. The app trades it, with its PKCE verifier, for a Health token.
- **Sign-out:**
  - the app's sign-out ends its Health token, and Health gives the app an address with an encrypted ticket;
  - opened in the system browser, it goes to Accounts with the session's ID token as `id_token_hint`;
  - after confirming, Hydra returns to Health's hand-off page, which sends `signed_out=1` back to the app;
  - the system browser's next sign-in asks for the password again.

Health's own app-client tests (`npm run test:app`) cover the app's side against a stand-in browser. Health's Mobile CI builds the Android debug APK and the iOS simulator app.

## On a real phone, against staging

Install a build whose API is `https://staging.health.lotuspond.ai` and use a test inbox verified in SES (docs/staging.md, step 2). On an iPhone and on an Android phone:

- [ ] **Continue with LotusPond Account** opens the system browser (SFSafariViewController on iOS, a Custom Tab on Android), never a web view inside the app.
- [ ] Accounts' sign-up page shows in that browser, readable at the phone's text size, and keyboard focus is visible.
- [ ] The confirmation email arrives. Opening its link **on the phone** confirms it. Choosing Continue returns to the app.
- [ ] **The return to the app:**
  - with universal links (iOS) and app links (Android) set up, it happens on a tap of the hand-off page's button;
  - without them, through the `ai.lotuspond.health:` scheme.
- [ ] The browser closes, and the app is signed in. Quitting and reopening the app keeps it signed in (Keychain on iOS, Keystore on Android).
- [ ] **Sign out in the app.** The system browser opens Accounts' "Sign out of LotusPond?" page. After confirming, it hands back to the app, which says it is signed out of both.
- [ ] Signing in again asks for the password.
- [ ] **Reset the password at Accounts** from another device. The app's session ends at its next request (back-channel logout).
- [ ] A person signed in to Accounts in the phone's browser signs in to the app without typing a password, where the platform shares the session. iOS's SFSafariViewController does not share Safari's cookies, so expect a password there.

Record the results, per platform and OS version, in `docs/validation/`.

## Stores

Submitting is done with the owner's Apple Developer and Google Play accounts, from Health's repository (`docs/mobile.md`). Before it:

- **Universal links:** set `APPLE_TEAM_ID` and `ANDROID_APP_SHA256` on Health staging and production, give `open.health.lotuspond.ai` DNS and a certificate, and turn on Associated Domains on the App ID (Health `docs/identity.md`).
- **The privacy texts** must be reviewed before the app ships the Accounts sign-in. That review is booked in M0, and M7 waits on it.
- **App Review's demo account.** Give the reviewers a synthetic staging or production account, never a real person's.
