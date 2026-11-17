// Opens the directory and every served cell, and applies their migrations: the directory first, then each cell in
// the order SERVED_REGIONS names them, stopping at the first failure (ADR-0002, Consequences).
import type { Config, Region } from '../config.ts';
import { fromRoot } from '../lib/paths.ts';
import { openDatabase, type Database } from './client.ts';

export const MIGRATIONS = { directory: fromRoot('drizzle', 'directory'), cell: fromRoot('drizzle', 'cell') };

export interface Databases {
  directory: Database;
  cells: Map<Region, Database>;
  close: () => Promise<void>;
}

export type Opener = (url: string) => Promise<Database>;

export async function openDatabases(config: Config, open: Opener = url => openDatabase({ url }), migrations = MIGRATIONS): Promise<Databases> {
  const opened: Database[] = [];
  const close = () => Promise.all(opened.map(d => d.close().catch(() => {}))).then(() => {});
  try {
    const directory = await open(config.directoryDatabaseUrl);
    opened.push(directory);
    await withContext('the directory database', () => directory.migrate(migrations.directory));
    const cells = new Map<Region, Database>();
    for (const cell of config.cells) {
      const db = await open(cell.databaseUrl);
      opened.push(db);
      await withContext(`the "${cell.region}" account cell`, () => db.migrate(migrations.cell));
      cells.set(cell.region, db);
    }
    return { directory, cells, close };
  } catch (e) {
    await close();
    throw e;
  }
}

async function withContext(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    throw new Error(`Migrating ${what} failed; no later database was migrated.`, { cause: e });
  }
}
