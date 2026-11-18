import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = {
  DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/accounts_directory',
  CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/accounts_in',
};

test('serves India by default, with its own cell database', () => {
  const c = loadConfig(base);
  assert.deepEqual(c.servedRegions, ['in']);
  assert.deepEqual(c.cells, [{ region: 'in', databaseUrl: base.CELL_IN_DATABASE_URL }]);
});

test('a served region without a cell database is refused', () => {
  assert.throws(() => loadConfig({ ...base, SERVED_REGIONS: 'in,eu' }), /CELL_EU_DATABASE_URL is not set/);
});

test('an unknown region is refused', () => {
  assert.throws(() => loadConfig({ ...base, SERVED_REGIONS: 'mars' }), /SERVED_REGIONS has "mars"/);
});

test('a cell may not share the directory database, even with other credentials', () => {
  assert.throws(
    () => loadConfig({ ...base, CELL_IN_DATABASE_URL: 'postgres://other:y@DB:5432/accounts_directory' }),
    /CELL_IN_DATABASE_URL is the same database as DIRECTORY_DATABASE_URL/,
  );
});

test('two cells may not share a database', () => {
  assert.throws(
    () => loadConfig({ ...base, SERVED_REGIONS: 'in,eu', CELL_EU_DATABASE_URL: base.CELL_IN_DATABASE_URL }),
    /CELL_EU_DATABASE_URL is the same database as CELL_IN_DATABASE_URL/,
  );
});

test('production needs https and the directory secret', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'http://accounts.lotuspond.ai' }), /must be https/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_URL: 'https://accounts.lotuspond.ai' }), /ACCOUNTS_DIRECTORY_SECRET is required/);
  const prod = { ...base, NODE_ENV: 'production', PUBLIC_URL: 'https://accounts.lotuspond.ai/', ACCOUNTS_DIRECTORY_SECRET: 'a'.repeat(64) };
  assert.throws(() => loadConfig(prod), /ACCOUNTS_COOKIE_SECRET is required/);
  assert.throws(() => loadConfig({ ...prod, ACCOUNTS_COOKIE_SECRET: 'b'.repeat(64) }), /MAIL_TRANSPORT must be ses in production/);
  const ok = loadConfig({ ...prod, ACCOUNTS_COOKIE_SECRET: 'b'.repeat(64), MAIL_TRANSPORT: 'ses' });
  assert.equal(ok.publicUrl, 'https://accounts.lotuspond.ai');
  assert.equal(ok.secureCookies, true);
});

test('a short directory secret is refused', () => {
  assert.throws(() => loadConfig({ ...base, ACCOUNTS_DIRECTORY_SECRET: 'short' }), ConfigError);
});

test('a missing directory database is refused', () => {
  assert.throws(() => loadConfig({ CELL_IN_DATABASE_URL: base.CELL_IN_DATABASE_URL }), /DIRECTORY_DATABASE_URL/);
});

test('open countries are ISO codes; India by default', () => {
  assert.deepEqual(loadConfig(base).openCountries, ['IN']);
  assert.deepEqual(loadConfig({ ...base, OPEN_COUNTRIES: 'in, gb' }).openCountries, ['IN', 'GB']);
  assert.throws(() => loadConfig({ ...base, OPEN_COUNTRIES: 'India' }), /ISO 3166-1/);
});

test('product addresses follow this service\'s own, or PRODUCT_URLS', () => {
  assert.deepEqual(loadConfig({ ...base, PUBLIC_URL: 'https://accounts.lotuspond.ai' }).productUrls,
    { health: 'https://health.lotuspond.ai', works: 'https://works.lotuspond.ai' });
  assert.deepEqual(loadConfig({ ...base, PUBLIC_URL: 'https://staging.accounts.lotuspond.ai' }).productUrls,
    { health: 'https://staging.health.lotuspond.ai', works: 'https://staging.works.lotuspond.ai' });
  assert.deepEqual(loadConfig({ ...base, PUBLIC_URL: 'http://localhost:8790' }).productUrls, {}, 'no accounts label: no links');
  assert.deepEqual(loadConfig({ ...base, PRODUCT_URLS: 'health=https://health.example/app' }).productUrls, { health: 'https://health.example' });
  assert.throws(() => loadConfig({ ...base, PRODUCT_URLS: 'mail=https://x.example' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, PRODUCT_URLS: 'health=not a url' }), ConfigError);
});
