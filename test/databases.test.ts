import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.ts';
import { openDatabase, type Database } from '../src/db/client.ts';
import { openDatabases } from '../src/db/databases.ts';

const config = loadConfig({
  DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/accounts_directory',
  CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/accounts_in',
});

async function tables(db: Database): Promise<string[]> {
  const res = await db.db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  return (res as unknown as { rows: { tablename: string }[] }).rows.map(r => r.tablename);
}

test('the directory and the cell each get only their own tables', async () => {
  const dbs = await openDatabases(config, () => openDatabase({ pglite: true }));
  try {
    assert.deepEqual(await tables(dbs.directory), ['directory', 'product_clients']);
    assert.deepEqual(await tables(dbs.cells.get('in')!), [
      'accounts', 'audit_events', 'credentials', 'email_tokens', 'legacy_links', 'product_sign_ins', 'sessions',
    ]);
  } finally {
    await dbs.close();
  }
});

test('migrating twice changes nothing', async () => {
  const db = await openDatabase({ pglite: true });
  const dbs = await openDatabases(config, async () => db);
  await openDatabases(config, async () => db);
  assert.equal((await tables(db)).length, 9);
  await dbs.close();
});

test('a failed cell migration stops start-up and closes every database opened so far', async () => {
  const closed: string[] = [];
  let n = 0;
  const open = async () => {
    const id = ++n === 1 ? 'directory' : 'cell';
    const db = await openDatabase({ pglite: true });
    return {
      ...db,
      migrate: id === 'cell' ? async () => { throw new Error('disk full'); } : db.migrate,
      close: async () => { closed.push(id); await db.close(); },
    };
  };
  await assert.rejects(openDatabases(config, open), /Migrating the "in" account cell failed/);
  assert.deepEqual(closed.sort(), ['cell', 'directory']);
});
