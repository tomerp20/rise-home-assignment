import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config';
import { createDb } from './db/connection';
import { initDb } from './db/schema';
import { createApp } from './app';
import { SqliteCampaignRepository } from './campaigns/campaign.repository';
import { DynamoDBCampaignRepository } from './campaigns/campaign.repository.dynamodb';
import { CampaignService } from './campaigns/campaign.service';

function main(): void {
  if (config.storage === 'dynamodb') {
    // DynamoDB mode — no SQLite connection; health check runs without a db ping.
    const campaignService = new CampaignService(new DynamoDBCampaignRepository());
    const app = createApp({ db: undefined, campaignService });

    app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port} (storage=dynamodb)`);
    });
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

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

main();
