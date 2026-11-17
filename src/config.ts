// Configuration from the environment, checked once at start-up. A wrong setting stops the server with a message
// that names the variable; it never starts half-configured.
import { z } from 'zod';

/** Data-residency cells, the same four as LotusPond Health (ADR-0001, decision 6). */
export const REGIONS = ['in', 'eu', 'us', 'global'] as const;
export type Region = (typeof REGIONS)[number];

const url = z.string().url();
/** A secret of at least 32 random bytes, written as hex or base64 (deploy/make-secrets.sh makes them). */
const secret = z.string().trim().min(43, 'must be at least 32 random bytes, as hex or base64');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** The address people see, e.g. https://accounts.lotuspond.ai. It is also Hydra's issuer. */
  PUBLIC_URL: url.default('http://localhost:8790'),
  /** Comma-separated regions whose account cells this server holds. Step 1 serves `in` only. */
  SERVED_REGIONS: z.string().default('in'),
  /** The global directory database: email HMAC to region, client registrations. Holds no personal data. */
  DIRECTORY_DATABASE_URL: url,
  /** Hydra's admin API. Reachable only on the private Docker network, never published. */
  HYDRA_ADMIN_URL: url.default('http://127.0.0.1:4445'),
  /** HMAC key for the email directory. Not Health's DIRECTORY_SECRET: Accounts has its own. */
  ACCOUNTS_DIRECTORY_SECRET: secret.optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
});

export interface CellConfig { region: Region; databaseUrl: string }

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  publicUrl: string;
  servedRegions: Region[];
  directoryDatabaseUrl: string;
  cells: CellConfig[];
  hydraAdminUrl: string;
  directorySecret: string | null;
  trustProxy: boolean;
}

export class ConfigError extends Error {}

/** The variable that holds a region's cell database, e.g. CELL_IN_DATABASE_URL. */
export const cellVar = (region: Region) => `CELL_${region.toUpperCase()}_DATABASE_URL`;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.') || '(environment)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  const servedRegions = [...new Set(e.SERVED_REGIONS.split(',').map(s => s.trim()).filter(Boolean))];
  if (servedRegions.length === 0) throw new ConfigError('Invalid configuration: SERVED_REGIONS names no region.');
  for (const r of servedRegions) {
    if (!(REGIONS as readonly string[]).includes(r)) {
      throw new ConfigError(`Invalid configuration: SERVED_REGIONS has "${r}"; use ${REGIONS.join(', ')}.`);
    }
  }

  // Every served region has its own database, distinct from the directory and from every other cell (ADR-0002).
  const seen = new Map<string, string>([[normalise(e.DIRECTORY_DATABASE_URL), 'DIRECTORY_DATABASE_URL']]);
  const cells: CellConfig[] = [];
  for (const region of servedRegions as Region[]) {
    const name = cellVar(region);
    const value = env[name]?.trim();
    if (!value) throw new ConfigError(`Invalid configuration: ${name} is not set, but SERVED_REGIONS includes "${region}".`);
    if (!url.safeParse(value).success) throw new ConfigError(`Invalid configuration: ${name} is not a URL.`);
    const other = seen.get(normalise(value));
    if (other) throw new ConfigError(`Invalid configuration: ${name} is the same database as ${other}. Each cell needs its own database.`);
    seen.set(normalise(value), name);
    cells.push({ region, databaseUrl: value });
  }

  if (e.NODE_ENV === 'production') {
    if (!e.PUBLIC_URL.startsWith('https://')) throw new ConfigError('Invalid configuration: PUBLIC_URL must be https in production.');
    if (!e.ACCOUNTS_DIRECTORY_SECRET) throw new ConfigError('Invalid configuration: ACCOUNTS_DIRECTORY_SECRET is required in production.');
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    servedRegions: servedRegions as Region[],
    directoryDatabaseUrl: e.DIRECTORY_DATABASE_URL,
    cells,
    hydraAdminUrl: e.HYDRA_ADMIN_URL.replace(/\/+$/, ''),
    directorySecret: e.ACCOUNTS_DIRECTORY_SECRET ?? null,
    trustProxy: e.TRUST_PROXY,
  };
}

/** Two URLs name the same database when host, port and database name match; user and password do not matter. */
function normalise(raw: string): string {
  const u = new URL(raw);
  return `${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname.replace(/\/+$/, '')}`;
}
