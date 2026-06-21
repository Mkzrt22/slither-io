/**
 * index.ts — Server entrypoint.
 *
 * Selects the storage backend from the environment (Postgres when
 * DATABASE_URL is set, otherwise an in-memory store for local dev), starts the
 * HTTP server, and shuts down cleanly on SIGTERM/SIGINT.
 */

import { buildApp } from './app.js';
import { MemoryStore, Store } from './store.js';
import { PostgresStore } from './pgStore.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const store: Store = databaseUrl ? new PostgresStore(databaseUrl) : new MemoryStore();
  await store.init();

  if (!databaseUrl) {
    console.warn(
      '[server] DATABASE_URL is not set — using the in-memory store. ' +
        'Data is lost on restart; set DATABASE_URL for persistence.',
    );
  }

  const app = buildApp(store, { logger: true });
  await app.listen({ port: PORT, host: HOST });

  const shutdown = async (): Promise<void> => {
    try {
      await app.close();
      await store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
