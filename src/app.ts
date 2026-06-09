import crypto from 'crypto';
import express, { Application, Request, Response, NextFunction } from 'express';
import pino, { Logger } from 'pino';
import Database from 'better-sqlite3';
import { createHealthRouter } from './health/health.routes';
import { createCampaignsRouter } from './campaigns/campaign.routes';
import { CampaignService } from './campaigns/campaign.service';
import { errorHandler } from './middleware/error-handler';
import { AppError } from './errors/app-error';
import { config } from './config';

// Augment Express's Request with the per-request pino child logger we attach
// below, so handlers and the error handler can call req.log.* type-safely.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      log: Logger;
    }
  }
}

export interface AppDeps {
  db?: Database.Database;
  campaignService: CampaignService;
}

export function createApp(deps: AppDeps): Application {
  const app = express();

  const logger = pino({ level: config.nodeEnv === 'test' ? 'silent' : config.logLevel });

  // Request logger. Emits ONE flat structured-JSON line per request carrying
  // exactly method, path, statusCode and durationMs — never headers (which may
  // hold Authorization/Cookie), query or body. A per-request child logger is
  // attached as req.log so handlers / the error handler can log correlated
  // diagnostics under the same reqId. Silent in NODE_ENV=test.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
    req.log = logger.child({ reqId });
    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1e6);
      req.log.info({
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  app.use(express.json());

  // Health
  app.use('/health', createHealthRouter(deps.db));

  app.use('/campaigns', createCampaignsRouter(deps.campaignService));

  // Catch-all for unmatched routes — return the JSON error envelope as a 404
  // instead of Express's default HTML "Cannot GET ...". Must come after the
  // routers and before the error handler.
  app.use((req, _res, next) => {
    next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
  });

  // Global error handler — must be last
  app.use(errorHandler);

  return app;
}
