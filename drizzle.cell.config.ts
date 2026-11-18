import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` writes the account cells' SQL migrations to ./drizzle/cell. Every cell gets the same chain.
export default defineConfig({ dialect: 'postgresql', schema: './src/db/cell-schema.ts', out: './drizzle/cell' });
