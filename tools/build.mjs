// Bundle the server into dist/index.js, and the migration and client-registration commands beside it. Dependencies stay
// external; migrations are copied next to the bundle by the Dockerfile.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/db/migrate-cli.ts', 'src/clients-cli.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  banner: { js: "process.env.NODE_ENV ??= 'production';" },
  logLevel: 'info',
});
