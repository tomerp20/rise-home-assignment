import Database from 'better-sqlite3';
import { Application } from 'express';
import { createDb } from '../../src/db/connection';
import { initDb } from '../../src/db/schema';
import { SqliteCampaignRepository } from '../../src/campaigns/campaign.repository';
import { CampaignService } from '../../src/campaigns/campaign.service';
import { createApp } from '../../src/app';

export interface TestApp {
  app: Application;
  db: Database.Database;
}

export function makeTestApp(): TestApp {
  const db = createDb(':memory:');
  initDb(db);
  const repo = new SqliteCampaignRepository(db);
  const campaignService = new CampaignService(repo);
  const app = createApp({ db, campaignService });
  return { app, db };
}
