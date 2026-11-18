// Operator commands, run inside the app container (docker compose exec app node dist/accounts-cli.js …).
//
//   import <export.jsonl> <answer.jsonl>   Import LotusPond Health's accounts:export file. Writes one
//                                          { health_user_id, sub } line per account for Health's accounts:link.
//   report [days]                          Sign-ins, failures, new and confirmed accounts per day (default 7), and
//                                          how far imported Health accounts have come. Counts only: no emails.
//
// The export holds emails and password hashes: hand it over a secure channel and delete it once imported. The answer
// is written readable by its owner only, and never over an existing file. The report printed here has no emails.
import fs from 'node:fs';
import { loadConfig } from './config.ts';
import { openDatabases } from './db/databases.ts';
import { importAccounts } from './import.ts';
import { loadKeys } from './lib/keys.ts';
import { buildReport, formatReport } from './report.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, input, answer] = process.argv.slice(2);
if (command === 'report') {
  const days = input ? Number(input) : 7;
  if (!Number.isInteger(days) || days < 1 || days > 90) fail('Usage: accounts-cli report [days, 1 to 90]');
  const config = loadConfig();
  const dbs = await openDatabases(config);
  try {
    console.log(formatReport(await buildReport({ directory: dbs.directory, cells: dbs.cells }, days)));
  } finally {
    await dbs.close();
  }
  process.exit(0);
}
if (command !== 'import' || !input || !answer) fail('Usage: accounts-cli import <export.jsonl> <answer.jsonl> | accounts-cli report [days]');
if (!fs.existsSync(input)) fail(`No such file: ${input}`);
if (fs.existsSync(answer)) fail(`${answer} already exists; it is never overwritten.`);
const config = loadConfig();
if (!config.directorySecret) fail('ACCOUNTS_DIRECTORY_SECRET must be set: the directory has to be readable by the server afterwards.');

const dbs = await openDatabases(config);
try {
  const report = await importAccounts({ directory: dbs.directory, cells: dbs.cells }, loadKeys(config), fs.readFileSync(input, 'utf8').split('\n'));
  fs.writeFileSync(answer, report.answers.map(a => JSON.stringify(a)).join('\n') + (report.answers.length ? '\n' : ''), { mode: 0o600, flag: 'wx' });
  console.log(`Created ${report.created}, already imported ${report.alreadyImported}, already linked ${report.alreadyLinked}, skipped ${report.skipped.length}.`);
  for (const s of report.skipped) console.log(`  skipped ${s.health_user_id ?? '(no id)'}: ${s.reason}`);
  console.log(`Answer for Health's accounts:link: ${answer} (${report.answers.length} lines).`);
} finally {
  await dbs.close();
}
