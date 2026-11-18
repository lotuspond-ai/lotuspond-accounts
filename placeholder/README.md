# The accounts.lotuspond.ai placeholder

One static page, "LotusPond accounts are not open yet", shown at every path of `accounts.lotuspond.ai` until LotusPond Accounts is deployed there. It is a Cloudflare Worker with static files only, `lotuspond-accounts-placeholder`, on the same Cloudflare account as the company site (`lotuspond-main`). It has no code, storage, secrets or forms.

The stylesheet and fonts are the Accounts app's own, built from `design/tokens.json`. They are generated into `public/assets/` and not committed.

## Deploy

1. **Remove the current DNS record for `accounts.lotuspond.ai`** in Cloudflare (DNS, Records). It points at another server today. Cloudflare will not attach a Worker custom domain to a name that already has a record.
2. **Build and deploy** from the repository root, signed in to Cloudflare (`npx wrangler@4.158.0 login`). Wrangler's sign-in stays outside the repository.

   ```sh
   npm ci
   npm run placeholder:build
   npx wrangler@4.158.0 deploy --config placeholder/wrangler.jsonc
   ```

   Wrangler creates the `accounts.lotuspond.ai` record and its certificate.
3. **Check** `https://accounts.lotuspond.ai/` and another path, such as `/login`. Both show the placeholder. Check at 1440, 768 and 375 pixels wide.

## Remove it, when Accounts goes live

Before pointing `accounts.lotuspond.ai` at the Accounts server (`docs/production.md`), remove the placeholder's custom domain. Use Cloudflare, Workers, `lotuspond-accounts-placeholder`, Domains, or delete the Worker. Then add the server's A and AAAA records.
