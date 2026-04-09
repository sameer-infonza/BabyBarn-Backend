import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';

export const authenticate = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new AppError(401, 'No token provided');
    }

    const decoded = verifyToken(token);
    req.user = decoded;
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
