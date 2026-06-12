import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';
import { prisma } from '../lib/prisma.js';

export const authenticate = async (req, res, next) => {
  try {
    void res;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new AppError(401, 'No token provided');
    }

    const decoded = verifyToken(token);
    let dbUser;
    try {
      dbUser = await prisma.user.findUnique({
        where: { publicId: decoded.id },
        select: {
          publicId: true,
          email: true,
          isActive: true,
          isGuest: true,
          adminModules: true,
          role: { select: { name: true } },
        },
      });
    } catch (error) {
      // Some environments may lag on auth-related columns while token auth still works.
      // Fall back to a minimal read to avoid blocking checkout/session endpoints.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2022') {
        dbUser = await prisma.user.findUnique({
          where: { publicId: decoded.id },
          select: {
            publicId: true,
            email: true,
          },
        });
      } else {
        throw error;
      }
    }
    if (!dbUser) {
      throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
    }
    if ('isActive' in dbUser && dbUser.isActive === false) {
      throw new AppError(403, 'This account has been deactivated.');
    }
    req.user = {
      ...decoded,
      id: dbUser.publicId,
      email: dbUser.email,
      role: ('role' in dbUser ? dbUser.role?.name : null) || decoded.role,
      adminModules: 'adminModules' in dbUser ? (dbUser.adminModules ?? null) : null,
    };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'Unauthorized', 'UNAUTHORIZED'));
  }
};

export const requireFullAccount = (req, res, next) => {
  void res;
  if (!req.user) {
    return next(new AppError(401, 'Unauthorized', 'UNAUTHORIZED'));
  }
  if (req.user.scope === 'checkout') {
    return next(
      new AppError(403, 'A full account is required for this action.', 'FULL_ACCOUNT_REQUIRED')
    );
  }
  if (req.user.isGuest) {
    return next(
      new AppError(
        403,
        'Complete your account registration to access this feature.',
        'GUEST_ACCOUNT'
      )
    );
  }
  next();
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new AppError(403, 'Forbidden'));
    } else {
      next();
    }
  };
};
