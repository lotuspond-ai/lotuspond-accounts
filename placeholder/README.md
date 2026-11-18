# The accounts.lotuspond.ai placeholder

One page, "LotusPond accounts are not open yet", shown at every path of `accounts.lotuspond.ai` until LotusPond Accounts is deployed there.

- It is a small Cloudflare Worker, `lotuspond-accounts-placeholder`, on the same Cloudflare account as the company site (`lotuspond-main`).
- The page, stylesheet and fonts are bundled into the Worker (`worker.ts`). It has no storage, secrets or forms, and refuses anything but GET and HEAD.
- The stylesheet and fonts are the Accounts app's own, built from `design/tokens.json` into `public/assets/` by `npm run placeholder:build`. They are not committed.
- The compatibility date is 2026-11-11, the newest that Wrangler 4.158.0's local runtime supports.

## Deploy

1. **Check that `accounts.lotuspond.ai` has no DNS record of its own** in Cloudflare (DNS, Records). Cloudflare will not attach a Worker custom domain to a name that already has one. On 18 November 2026 it had none.
2. **Build and deploy** from the repository root. Sign in with `npx wrangler@4.158.0 login`, or set a `CLOUDFLARE_API_TOKEN` that may edit Workers and the `lotuspond.ai` zone. Neither belongs in the repository.

   ```sh
   npm ci
   npm run placeholder:build
   npx wrangler@4.158.0 deploy --config placeholder/wrangler.jsonc
   ```

   Wrangler creates the `accounts.lotuspond.ai` record and its certificate.
3. **Check** `https://accounts.lotuspond.ai/` and another path, such as `/login`. Both show the placeholder. Check at 1440, 768 and 375 pixels wide.

## Remove it, when Accounts goes live

Before pointing `accounts.lotuspond.ai` at the Accounts server (`docs/production.md`), remove the placeholder's custom domain. Use Cloudflare, Workers, `lotuspond-accounts-placeholder`, Domains, or delete the Worker. Then add the server's A and AAAA records.
