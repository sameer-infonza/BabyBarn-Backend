import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { generateToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    role: user.role.name,
  };
}

export class AuthService {
  async getUserRoleId(name) {
    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) {
      throw new AppError(500, 'Role configuration missing', 'ROLE_CONFIG_ERROR');
    }
    return role.id;
  }

  async register(email, password, firstName, lastName) {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new AppError(400, 'Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultRole = process.env.DEFAULT_ROLE || 'CUSTOMER';
    let userRoleId;
    try {
      userRoleId = await this.getUserRoleId(defaultRole);
    } catch {
      userRoleId = await this.getUserRoleId('CUSTOMER');
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        roleId: userRoleId,
      },
      include: { role: true },
    });

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role.name,
    };

    const token = generateToken(payload);

    return { user: toPublicUser(user), token };
  }

  async login(email, password) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      throw new AppError(401, 'Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid credentials');
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role.name,
    };

    const token = generateToken(payload);

    return {
      user: toPublicUser(user),
      token,
    };
  }

  async getUserById(id) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        role: { select: { name: true } },
      },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      role: user.role.name,
      phone: user.phone,
      createdAt: user.createdAt,
    };
  }

  async forgotPassword(email) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

      const raw = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await prisma.passwordResetToken.create({
        data: {
          token: raw,
          userId: user.id,
          expiresAt,
        },
      });

      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${baseUrl}/auth/reset-password?token=${raw}`;

      if (process.env.NODE_ENV === 'development') {
        console.info('[auth] Password reset link (dev only):', resetUrl);
      }

      return {
        message: 'If an account exists for this email, a reset link has been sent.',
        ...(process.env.NODE_ENV === 'development' ? { devResetUrl: resetUrl } : {}),
      };
    }

    return {
      message: 'If an account exists for this email, a reset link has been sent.',
    };
  }

  async resetPassword(token, password) {
    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError(400, 'Invalid or expired reset token', 'INVALID_RESET_TOKEN');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Password updated successfully' };
  }
}

export const authService = new AuthService();
