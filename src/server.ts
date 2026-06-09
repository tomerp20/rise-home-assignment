import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config';
import { createDb } from './db/connection';
import { initDb } from './db/schema';
import { createApp } from './app';

function main(): void {
  // Ensure the data directory exists (skipped for :memory:)
  if (config.dbPath !== ':memory:') {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }

  const db = createDb(config.dbPath);
  initDb(db);

  const app = createApp({ db });

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

main();
