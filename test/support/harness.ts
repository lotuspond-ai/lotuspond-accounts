// The app in memory: real schema in PGlite, fake Hydra, outbox mailer. One harness per test keeps tests independent.
import { createApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { openDatabase } from '../../src/db/client.ts';
import { openDatabases } from '../../src/db/databases.ts';
import { productClients } from '../../src/db/directory-schema.ts';
import { loadKeys } from '../../src/lib/keys.ts';
import { Outbox } from '../../src/mail/mailer.ts';
import { Browser } from './browser.ts';
import { FakeHydra } from './fake-hydra.ts';

export async function harness(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:8080',
    DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/accounts_directory',
    CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/accounts_in',
    ...env,
  });
  const dbs = await openDatabases(config, () => openDatabase({ pglite: true }));
  await dbs.directory.db.insert(productClients).values([
    { clientId: 'lotuspond-health', product: 'health' },
    { clientId: 'lotuspond-works', product: 'works' },
  ]);
  const hydra = new FakeHydra();
  const outbox = new Outbox();
  const app = createApp({ config, directory: dbs.directory, cells: dbs.cells, hydra, keys: loadKeys(config), mailer: outbox });
  const browser = () => new Browser((url, init) => Promise.resolve(app.request(url, init)));
  return { app, dbs, hydra, outbox, browser, close: () => dbs.close() };
}
