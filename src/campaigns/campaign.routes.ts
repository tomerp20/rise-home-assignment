import { Router, Request, Response, NextFunction } from 'express';
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

// Parse a quoted ETag string ("1") into an integer. Returns undefined on malformed input.
function parseIfMatch(value: string): number | undefined {
  const m = value.match(/^"(\d+)"$/);
  if (!m) return undefined;
  return parseInt(m[1], 10);
}

export function createCampaignsRouter(service: CampaignService): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createCampaignSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const campaign = service.create(req.body);
        res
          .status(201)
          .location(`/campaigns/${campaign.id}`)
          .setHeader('ETag', etag(campaign))
          .json(campaign);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/',
    validate({ query: listCampaignsQuerySchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const result = service.list(req.query as unknown as ListCampaignsQuery);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/:id/metrics',
    validate({ params: idParamSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const metrics = service.getMetrics(req.params.id);
        res.status(200).json(metrics);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/:id',
    validate({ params: idParamSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const campaign = service.getById(req.params.id);
        res.status(200).setHeader('ETag', etag(campaign)).json(campaign);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: patchCampaignSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const ifMatchHeader = req.headers['if-match'];
        let ifMatchVersion: number | undefined;

        if (ifMatchHeader !== undefined) {
          ifMatchVersion = parseIfMatch(ifMatchHeader);
          if (ifMatchVersion === undefined) {
            throw AppError.badRequest('If-Match must be a quoted integer e.g. "1"');
          }
        }

        const campaign = service.updateStatus(
          req.params.id,
          req.body.status as CampaignStatus,
          ifMatchVersion,
        );
        res.status(200).setHeader('ETag', etag(campaign)).json(campaign);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        service.delete(req.params.id);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
