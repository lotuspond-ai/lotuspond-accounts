// Opens the directory and every served cell, and applies their migrations: the directory first, then each cell in
// the order SERVED_REGIONS names them, stopping at the first failure (ADR-0002, Consequences).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, Region } from '../config.ts';
import { openDatabase, type Database } from './client.ts';

/** The migrations folder: the nearest `drizzle/` above this file, so it is found from src/db/ and from dist/ alike. */
function migrationsRoot(): string {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'drizzle');
    if (fs.existsSync(path.join(candidate, 'cell'))) return candidate;
    if (path.dirname(dir) === dir) throw new Error('No drizzle/ migrations folder found above the server.');
  }
}

const root = migrationsRoot();
export const MIGRATIONS = { directory: path.join(root, 'directory'), cell: path.join(root, 'cell') };

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
