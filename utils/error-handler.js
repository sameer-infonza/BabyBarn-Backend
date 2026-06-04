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

function mapPrismaError(err) {
  const prismaCode = typeof err?.code === 'string' ? err.code : '';
  const name = typeof err?.name === 'string' ? err.name : '';

  if (name === 'PrismaClientInitializationError' || prismaCode === 'P1001' || prismaCode === 'P1000') {
    return new AppError(
      503,
      'Database is unavailable. Start PostgreSQL and verify DATABASE_URL in backend/.env.',
      'DATABASE_UNAVAILABLE'
    );
  }

  if (!/^P\d{4}$/.test(prismaCode)) return null;

  if (prismaCode === 'P2025') {
    return new AppError(404, 'Requested record was not found', `PRISMA_${prismaCode}`, { prismaCode });
  }
  if (prismaCode === 'P2002') {
    return new AppError(409, 'Unique constraint failed', `PRISMA_${prismaCode}`, { prismaCode });
  }
  if (prismaCode === 'P2003') {
    return new AppError(409, 'Related record constraint failed', `PRISMA_${prismaCode}`, { prismaCode });
  }

  return new AppError(500, 'Internal server error', `PRISMA_${prismaCode}`, { prismaCode });
}

export const errorHandler = (err, req, res, next) => {
  void req;
  void next;
  const prismaMappedError = mapPrismaError(err);
  if (prismaMappedError) {
    console.error('[prisma]', {
      code: err.code,
      message: err.message,
      meta: err.meta || null,
    });
    err = prismaMappedError;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      console.error('[api]', {
        status: err.statusCode,
        message: err.message,
        code: err.code,
        path: req?.method && req?.originalUrl ? `${req.method} ${req.originalUrl}` : undefined,
      });
    } else if (process.env.NODE_ENV === 'development') {
      console.warn('[api]', {
        status: err.statusCode,
        message: err.message,
        path: req?.method && req?.originalUrl ? `${req.method} ${req.originalUrl}` : undefined,
      });
    }
  } else {
    console.error('[unhandled]', {
      message: err?.message,
      path: req?.method && req?.originalUrl ? `${req.method} ${req.originalUrl}` : undefined,
      stack: err?.stack,
    });
  }

  if (err?.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      code: 'UPLOAD_ERROR',
      message: err.message || 'File upload failed',
    });
  }
  if (err?.message && typeof err.message === 'string' && err.message.includes('JPEG')) {
    return res.status(400).json({
      success: false,
      code: 'UPLOAD_ERROR',
      message: err.message,
    });
  }

  const error = err instanceof AppError ? err : new AppError(500, 'Internal server error');

  res.status(error.statusCode).json({
    success: false,
    code: error.code || 'INTERNAL_ERROR',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
};
