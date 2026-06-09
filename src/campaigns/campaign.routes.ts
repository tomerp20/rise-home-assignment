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
import { CampaignStatus } from './campaign.types';

export function createCampaignsRouter(service: CampaignService): Router {
  const router = Router();

  router.post(
    '/',
    validate({ body: createCampaignSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const campaign = service.create(req.body);
        res.status(201).json(campaign);
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
    '/:id',
    validate({ params: idParamSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const campaign = service.getById(req.params.id);
        res.status(200).json(campaign);
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
        const campaign = service.updateStatus(
          req.params.id,
          req.body.status as CampaignStatus,
        );
        res.status(200).json(campaign);
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
