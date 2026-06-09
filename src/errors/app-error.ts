export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static conflict(message: string): AppError {
    return new AppError(409, 'CONFLICT', message);
  }

  static badRequest(message: string): AppError {
    return new AppError(400, 'BAD_REQUEST', message);
  }

  // Failed If-Match precondition. RFC 7232 §4.2 mandates 412 (not 409) when a
  // conditional request's precondition evaluates to false.
  static preconditionFailed(
    message = 'Campaign was modified by another request; re-fetch and retry',
  ): AppError {
    return new AppError(412, 'PRECONDITION_FAILED', message);
  }
}
