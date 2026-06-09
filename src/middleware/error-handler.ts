import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.statusCode).json({ error: body });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}
