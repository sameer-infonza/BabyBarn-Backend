import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from './error-handler.js';

export const generateToken = (payload) => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiryTime,
  });
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'Token has expired', 'TOKEN_EXPIRED');
    }
    throw new AppError(401, 'Invalid token', 'INVALID_TOKEN');
  }
};
