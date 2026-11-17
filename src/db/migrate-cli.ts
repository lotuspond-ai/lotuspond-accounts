// Apply migrations without starting the server: `npm run db:migrate`. The server also does this on start-up.
import { loadConfig } from '../config.ts';
import { openDatabases } from './databases.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file */ }
const config = loadConfig();
const dbs = await openDatabases(config);
console.log(`Migrations applied: directory, ${config.cells.map(c => `cell ${c.region}`).join(', ')}.`);
await dbs.close();
