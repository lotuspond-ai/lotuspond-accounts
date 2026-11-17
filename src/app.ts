// The Accounts web app. In M1 it serves only its health check; sign-up, sign-in, email links and Hydra's login and
// consent handlers arrive in M2. Hydra itself serves /oauth2/*, /userinfo and /.well-known/* (deploy/Caddyfile).
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Region } from './config.ts';
import type { Database } from './db/client.ts';
import type { Hydra } from './hydra.ts';

export interface Deps {
  directory: Pick<Database, 'ping'>;
  cells: Map<Region, Pick<Database, 'ping'>>;
  hydra: Hydra;
}

export interface HealthReport {
  status: 'ok' | 'unavailable';
  directory: boolean;
  cells: Partial<Record<Region, boolean>>;
  hydra: boolean;
}

export function createApp(deps: Deps) {
  const app = new Hono();

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    referrerPolicy: 'no-referrer',
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
  }));
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  /** Ready only when every database this server holds and Hydra answer. Reports which part failed, never why. */
  app.get('/api/health', async c => {
    const regions = [...deps.cells.keys()];
    const [directory, hydra, ...cellResults] = await Promise.all([
      deps.directory.ping(),
      deps.hydra.ready(),
      ...regions.map(r => deps.cells.get(r)!.ping()),
    ]);
    const cells = Object.fromEntries(regions.map((r, i) => [r, cellResults[i]]));
    const ok = directory && hydra && cellResults.every(Boolean);
    return c.json<HealthReport>({ status: ok ? 'ok' : 'unavailable', directory, cells, hydra }, ok ? 200 : 503);
  });

  app.notFound(c => c.json({ error: 'not_found' }, 404));
  app.onError((_err, c) => c.json({ error: 'internal' }, 500));

  return app;
}
