// A synthetic LotusPond Health accounts:export file, for rehearsing the import on staging and in tests. Every account is
// made up: emails at example.com (reserved for examples), random ids, and one shared test password hashed the way
// Health hashes it. Never use it for anything but tests.
//   npx tsx tools/synthetic-health-export.ts <count> <out.jsonl> [password]
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/password.ts';

const [countArg, out, password = 'synthetic test passphrase'] = process.argv.slice(2);
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || count > 10_000 || !out) {
  console.error('Usage: npx tsx tools/synthetic-health-export.ts <count 1-10000> <out.jsonl> [password]');
  process.exit(1);
}
if (fs.existsSync(out)) { console.error(`${out} already exists.`); process.exit(1); }
const hash = await hashPassword(password);
const run = randomBytes(3).toString('hex');
const lines: string[] = [];
for (let i = 1; i <= count; i++) {
  lines.push(JSON.stringify({
    health_user_id: randomUUID(), email: `synthetic-${run}-${i}@example.com`, password_hash: hash, region: 'in', country: 'IN',
    created_at: new Date(Date.now() - i * 86_400_000).toISOString(), accounts_subject: null,
  }));
}
fs.writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Wrote ${count} synthetic accounts to ${out} (emails synthetic-${run}-N@example.com).`);
