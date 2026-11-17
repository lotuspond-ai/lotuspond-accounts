// Start LotusPond Accounts: check configuration, open and migrate every database, then serve.
import { serve } from '@hono/node-server';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabases } from './db/databases.ts';
import { createApp } from './app.ts';
import { hydraAdmin } from './hydra.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const dbs = await openDatabases(config);
const app = createApp({ directory: dbs.directory, cells: dbs.cells, hydra: hydraAdmin(config.hydraAdminUrl) });
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, info => {
  console.log(`LotusPond Accounts on port ${info.port}, cells: ${config.servedRegions.join(', ')}.`);
});

const stop = () => server.close(() => void dbs.close().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
