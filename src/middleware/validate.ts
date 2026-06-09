import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../errors/app-error';

interface ValidateSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: { path: string; message: string }[] = [];

    for (const [part, schema] of Object.entries(schemas) as [keyof ValidateSchemas, ZodSchema][]) {
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ path: issue.path.join('.'), message: issue.message });
        }
      } else {
        req[part] = result.data;
      }
    }

    if (errors.length > 0) {
      return next(AppError.validation('Validation failed', errors));
    }
    next();
  };
}
