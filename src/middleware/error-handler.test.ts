import { Request, Response } from 'express';
import { errorHandler } from './error-handler';
import { AppError } from '../errors/app-error';

function makeRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = jest.fn((code: number) => {
    res._status = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res._json = body;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function makeReq(log?: { error: jest.Mock }): Request {
  return { log } as unknown as Request;
}

describe('errorHandler', () => {
  it('maps a known AppError to its status + descriptive envelope', () => {
    const res = makeRes();
    errorHandler(AppError.notFound('Campaign x not found'), makeReq(), res, jest.fn());
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: { code: 'NOT_FOUND', message: 'Campaign x not found' } });
  });

  it('maps a malformed-JSON SyntaxError to 400 VALIDATION_ERROR', () => {
    const res = makeRes();
    const err = Object.assign(new SyntaxError('Unexpected token'), { body: '{bad' });
    errorHandler(err, makeReq(), res, jest.fn());
    expect(res._status).toBe(400);
    expect((res._json as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a generic 500 (no internal text) AND logs the full error server-side', () => {
    const res = makeRes();
    const log = { error: jest.fn() };
    const internal = new Error('SECRET internal stack detail');
    errorHandler(internal, makeReq(log), res, jest.fn());

    expect(res._status).toBe(500);
    expect(res._json).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(JSON.stringify(res._json)).not.toContain('SECRET');
    // logged server-side with the real error
    expect(log.error).toHaveBeenCalledWith(internal);
  });
});
