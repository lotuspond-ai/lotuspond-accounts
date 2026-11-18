# The accounts.lotuspond.ai placeholder: deployed

Date: 18 November 2026. Deployed from a cloud container, with the Cloudflare API token saved on the owner's "LotusPond" cloud environment.

## Before

- The `lotuspond.ai` zone had no record for `accounts.lotuspond.ai`, and no wildcard record. Nothing was deleted.

## Why the Worker bundles its files

- The first deploy, with Workers static assets, failed: the assets upload answered 401.
- The container's proxy puts the saved API token in the `Authorization` header. That replaces the short-lived upload token Wrangler sends for assets.
- The Worker now bundles the page, stylesheet and fonts, which needs only the API token.

## Local, before deploying

- `wrangler dev` (4.158.0, compatibility date 2026-11-11):
  - `/`, `/login`, `/robots.txt`, the stylesheet and both fonts answered 200 with the right types;
  - the page carried the content security policy and `X-Robots-Tag: noindex`;
  - a POST answered 405.
- In Chromium at 1440, 768 and 375 pixels wide, light and dark: nothing scrolls sideways, and keyboard focus reaches the button with a visible ring.
- `npm run check`: typecheck and lint passed; 70 tests passed.

## Deployed

- `npx wrangler@4.158.0 deploy --config placeholder/wrangler.jsonc` uploaded `lotuspond-accounts-placeholder`, version `341e991e-5d2a-4271-8e82-bd0cdb12eb08`, with the custom domain `accounts.lotuspond.ai`.
- The Cloudflare API then showed:
  - the custom domain `accounts.lotuspond.ai` serving `lotuspond-accounts-placeholder` (production);
  - the DNS record `AAAA accounts.lotuspond.ai 100::`, proxied, created by Cloudflare;
  - its certificate pack as `pending_validation`.

## Not verified from here

- The container's network does not allow `accounts.lotuspond.ai`, so the live page was not fetched over HTTPS.
- The certificate was still being issued when this was written.
- Check the live page in a browser once the certificate is active.
