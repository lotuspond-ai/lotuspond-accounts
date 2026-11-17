// Database connections: PostgreSQL in every deployment. Tests use embedded PGlite (Postgres compiled to WASM), so
// they need no server.
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  /** Apply the migrations in a folder. Several servers may start together: one migrates while the others wait. */
  migrate: (migrationsFolder: string) => Promise<void>;
  /** True when the database answers a trivial query. */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Advisory lock key for migrations, the same on every database this service owns. */
const MIGRATION_LOCK = 4_172_001;

export async function openDatabase(opts: { url: string } | { pglite: true }): Promise<Database> {
  if ('url' in opts) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10, connectionTimeoutMillis: 5_000 });
    // An idle connection that drops (database restart) must not crash the process.
    pool.on('error', () => {});
    const db = drizzle({ client: pool }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      migrate: async folder => {
        const conn = await pool.connect();
        try {
          await conn.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
          await migrate(drizzle({ client: conn }), { migrationsFolder: folder });
        } finally {
          await conn.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
          conn.release();
        }
      },
      ping: () => ping(db),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite();
  const db = drizzle({ client });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    migrate: folder => migrate(db, { migrationsFolder: folder }),
    ping: () => ping(db as unknown as Db),
    close: () => client.close(),
  };
}

async function ping(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
