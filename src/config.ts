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
  /** Signs form tokens and hashes client addresses in the audit log. */
  ACCOUNTS_COOKIE_SECRET: secret.optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  /** Countries whose residents can sign up, comma-separated ISO codes. India only in step 1. */
  OPEN_COUNTRIES: z.string().default('IN'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * How email is sent. `ses`: Amazon SES (production). `outbox`: kept in memory and shown at /dev/outbox, for
   * development and tests only; production refuses it.
   */
  MAIL_TRANSPORT: z.enum(['outbox', 'ses']).default('outbox'),
  MAIL_FROM: z.string().trim().min(3).default('LotusPond Accounts <accounts@lotuspond.ai>'),
  /** SES region. Mumbai keeps addresses and messages in India. Credentials come from the standard AWS variables. */
  SES_REGION: z.string().trim().default('ap-south-1'),
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
  cookieSecret: string | null;
  trustProxy: boolean;
  openCountries: string[];
  sessionTtlMs: number;
  /** Secure cookies and the __Host- prefix: on whenever PUBLIC_URL is https. */
  secureCookies: boolean;
  mail: { transport: 'outbox' | 'ses'; from: string; sesRegion: string };
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
    if (!e.ACCOUNTS_COOKIE_SECRET) throw new ConfigError('Invalid configuration: ACCOUNTS_COOKIE_SECRET is required in production.');
    if (e.MAIL_TRANSPORT !== 'ses') throw new ConfigError('Invalid configuration: MAIL_TRANSPORT must be ses in production; the outbox is for development and tests.');
  }
  const openCountries = e.OPEN_COUNTRIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  for (const c of openCountries) {
    if (!/^[A-Z]{2}$/.test(c)) throw new ConfigError(`Invalid configuration: OPEN_COUNTRIES has "${c}"; use ISO 3166-1 alpha-2 codes.`);
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
    cookieSecret: e.ACCOUNTS_COOKIE_SECRET ?? null,
    trustProxy: e.TRUST_PROXY,
    openCountries,
    sessionTtlMs: e.SESSION_DAYS * 24 * 60 * 60 * 1000,
    secureCookies: e.PUBLIC_URL.startsWith('https://'),
    mail: { transport: e.MAIL_TRANSPORT, from: e.MAIL_FROM, sesRegion: e.SES_REGION },
  };
}

/** Two URLs name the same database when host, port and database name match; user and password do not matter. */
function normalise(raw: string): string {
  const u = new URL(raw);
  return `${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname.replace(/\/+$/, '')}`;
}
