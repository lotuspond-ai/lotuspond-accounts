import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` writes the directory database's SQL migrations to ./drizzle/directory.
export default defineConfig({ dialect: 'postgresql', schema: './src/db/directory-schema.ts', out: './drizzle/directory' });
