// The LotusPond products this account signs in to, and where each one lives, for the account page's product cards.
import type { Product } from '../accounts.ts';

export const PRODUCTS: readonly Product[] = ['health', 'works'];

/**
 * Each product's web address. PRODUCT_URLS names them ("health=https://…,works=https://…"); otherwise they follow
 * this service's own address, with the `accounts` label swapped for the product's: accounts.lotuspond.ai gives
 * health.lotuspond.ai, and staging.accounts.lotuspond.ai gives staging.health.lotuspond.ai. An address that has no
 * `accounts` label, such as localhost, gives none, and the page then shows no link.
 */
export function productUrls(publicUrl: string, setting?: string): Partial<Record<Product, string>> {
  if (setting?.trim()) {
    const out: Partial<Record<Product, string>> = {};
    for (const part of setting.split(',').map(s => s.trim()).filter(Boolean)) {
      const at = part.indexOf('=');
      const product = part.slice(0, at).trim() as Product;
      const value = part.slice(at + 1).trim();
      if (at < 1 || !PRODUCTS.includes(product)) throw new Error(`PRODUCT_URLS has "${part}"; use health=<url> or works=<url>.`);
      let url: URL;
      try { url = new URL(value); } catch { throw new Error(`PRODUCT_URLS has "${part}"; ${product} needs a full URL.`); }
      out[product] = url.origin;
    }
    return out;
  }
  const own = new URL(publicUrl);
  const labels = own.hostname.split('.');
  const at = labels.indexOf('accounts');
  if (at < 0) return {};
  return Object.fromEntries(PRODUCTS.map(p => {
    const host = [...labels.slice(0, at), p, ...labels.slice(at + 1)].join('.');
    return [p, `${own.protocol}//${host}${own.port ? `:${own.port}` : ''}`];
  }));
}
