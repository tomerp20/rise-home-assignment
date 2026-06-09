import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';

export function createHealthRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      db.prepare('SELECT 1').get();
      res.status(200).json({ status: true });
    } catch {
      res.status(503).json({ status: false });
    }
  });

  return router;
}
