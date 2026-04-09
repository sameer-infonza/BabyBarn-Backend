export class AppError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const errorHandler = (err, req, res, next) => {
  void req;
  void next;
  const error = err instanceof AppError ? err : new AppError(500, 'Internal server error');

  res.status(error.statusCode).json({
    success: false,
    code: error.code || 'INTERNAL_ERROR',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
};
