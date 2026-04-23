import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const authenticate = async (req, res, next) => {
  try {
    void res;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new AppError(401, 'No token provided');
    }

    const decoded = verifyToken(token);
    const dbUser = await prisma.user.findUnique({
      where: { publicId: decoded.id },
      select: {
        publicId: true,
        email: true,
        isActive: true,
        adminModules: true,
        role: { select: { name: true } },
      },
    });
    if (!dbUser) {
      throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
    }
    if (dbUser.isActive === false) {
      throw new AppError(403, 'This account has been deactivated.');
    }
    req.user = {
      ...decoded,
      id: dbUser.publicId,
      email: dbUser.email,
      role: dbUser.role?.name || decoded.role,
      adminModules: dbUser.adminModules ?? null,
    };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'Unauthorized', 'UNAUTHORIZED'));
  }
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
