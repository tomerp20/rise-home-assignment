import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { validate } from '../middleware/validate';
import {
  createCampaignSchema,
  patchCampaignSchema,
  listCampaignsQuerySchema,
  idParamSchema,
  ListCampaignsQuery,
} from './campaign.schema';
import { CampaignService } from './campaign.service';
import { Campaign, CampaignStatus } from './campaign.types';
import { AppError } from '../errors/app-error';

function etag(campaign: Campaign): string {
  return `"${campaign.version}"`;
}

function parseIfMatch(value: string): number | undefined {
  const m = value.match(/^"(\d+)"$/);
  if (!m) return undefined;
  return parseInt(m[1], 10);
}

// Express 4: thrown errors in async handlers don't reach the global error handler.
// This wrapper catches rejections and forwards them via next().
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

export function createCampaignsRouter(service: CampaignService): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createCampaignSchema }),
    asyncHandler(async (req, res) => {
      const campaign = await service.create(req.body);
      res.status(201).location(`/campaigns/${campaign.id}`).setHeader('ETag', etag(campaign)).json(campaign);
    }),
  );

  router.get(
    '/',
    validate({ query: listCampaignsQuerySchema }),
    asyncHandler(async (req, res) => {
      const result = await service.list(req.query as unknown as ListCampaignsQuery);
      res.status(200).json(result);
    }),
  );

  router.get(
    '/:id/metrics',
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      const metrics = await service.getMetrics(req.params.id);
      res.status(200).json(metrics);
    }),
  );

  router.get(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      const campaign = await service.getById(req.params.id);
      res.status(200).setHeader('ETag', etag(campaign)).json(campaign);
    }),
  );

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: patchCampaignSchema }),
    asyncHandler(async (req, res) => {
      const ifMatchHeader = req.headers['if-match'];
      let ifMatchVersion: number | undefined;

      if (ifMatchHeader !== undefined) {
        ifMatchVersion = parseIfMatch(ifMatchHeader);
        if (ifMatchVersion === undefined) {
          throw AppError.badRequest('If-Match must be a quoted integer e.g. "1"');
        }
      }

      const campaign = await service.updateStatus(
        req.params.id,
        req.body.status as CampaignStatus,
        ifMatchVersion,
      );
      res.status(200).setHeader('ETag', etag(campaign)).json(campaign);
    }),
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
      await service.delete(req.params.id);
      res.status(204).send();
    }),
  );

  return router;
}
