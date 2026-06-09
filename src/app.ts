import express, { Application } from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import Database from 'better-sqlite3';
import { createHealthRouter } from './health/health.routes';
import { errorHandler } from './middleware/error-handler';
import { config } from './config';

export interface AppDeps {
  db: Database.Database;
}

export function createApp(deps: AppDeps): Application {
  const app = express();

  // Request logger — silent in test to avoid noisy output
  app.use(
    pinoHttp({
      logger: pino({ level: config.nodeEnv === 'test' ? 'silent' : config.logLevel }),
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
      customSuccessMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
    }),
  );

  app.use(express.json());

  // Health
  app.use('/health', createHealthRouter(deps.db));

  // ── T2: mount campaigns router here ──────────────────────────────────────
  // import { createCampaignsRouter } from './campaigns/campaigns.routes';
  // app.use('/campaigns', createCampaignsRouter(deps));
  // ─────────────────────────────────────────────────────────────────────────

  // Global error handler — must be last
  app.use(errorHandler);

  return app;
}
