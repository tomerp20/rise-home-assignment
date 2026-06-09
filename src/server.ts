import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import { config } from './config';
import { createDb } from './db/connection';
import { initDb } from './db/schema';
import { createApp } from './app';
import { SqliteCampaignRepository } from './campaigns/campaign.repository';
import { DynamoDBCampaignRepository } from './campaigns/campaign.repository.dynamodb';
import { CampaignService } from './campaigns/campaign.service';

// Close the HTTP server (stop accepting connections, drain in-flight) then the
// DB, so a SIGTERM/SIGINT (e.g. container stop, Ctrl-C) shuts down cleanly.
function installGracefulShutdown(server: Server, db?: Database.Database): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      db?.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function main(): void {
  if (config.storage === 'dynamodb') {
    // DynamoDB mode — no SQLite connection; health check runs without a db ping.
    const campaignService = new CampaignService(new DynamoDBCampaignRepository());
    const app = createApp({ db: undefined, campaignService });

    const server = app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port} (storage=dynamodb)`);
    });
    installGracefulShutdown(server);
    return;
  }

  // SQLite mode (default).
  // Ensure the data directory exists (skipped for :memory:)
  if (config.dbPath !== ':memory:') {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }

  const db = createDb(config.dbPath);
  initDb(db);

  const campaignService = new CampaignService(new SqliteCampaignRepository(db));
  const app = createApp({ db, campaignService });

  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
  installGracefulShutdown(server, db);
}

main();
