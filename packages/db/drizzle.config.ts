import { defineConfig } from 'drizzle-kit';

// Migration uses the admin DATABASE_URL (owns objects, can CREATE ROLE / triggers).
// Runtime app code uses the restricted ledger_app role via APP_DATABASE_URL — see src/client.ts.
const url = process.env.DATABASE_URL;
if (!url) {
  // Only thrown when a drizzle-kit command actually runs (generate works offline without it).
  console.warn('[drizzle] DATABASE_URL not set — `migrate`/`studio` will fail until you fill .env');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: url ?? '' },
  strict: true,
  verbose: true,
});
