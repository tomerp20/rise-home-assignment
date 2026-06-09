import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.statusCode).json({ error: body });
    return;
  }

  // Malformed JSON body: express.json() throws a SyntaxError carrying the raw
  // `body`. That's a client mistake → 400, not a 500.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON in request body' },
    });
    return;
  }

  // Truly unexpected error. Log the full detail server-side so 500s leave a
  // diagnostic trail, but return a GENERIC message to the client — internal
  // details (SQLite errors, stack traces) must never leak in the response.
  req.log?.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}
