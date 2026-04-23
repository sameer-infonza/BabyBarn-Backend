import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { generateToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';

const prisma = new PrismaClient();

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function toPublicUser(user) {
  const accessUntil = user.accessMemberUntil ?? null;
  const accessActive = accessUntil != null && accessUntil > new Date();
  const roleName = typeof user.role === 'object' && user.role?.name ? user.role.name : user.role;
  const out = {
    id: user.publicId,
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    role: roleName,
    accessMemberUntil: accessUntil ? accessUntil.toISOString() : null,
    accessMemberActive: Boolean(accessActive),
  };
  if (roleName === 'ADMIN' || roleName === 'ADMIN_TEAM') {
    out.adminModules = user.adminModules !== undefined ? user.adminModules : null;
  }
  return out;
}

export class AuthService {
  async sendAuthEmail(payload) {
    try {
      return await emailService.sendTemplate(payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'Unable to send email right now. Please try again later.',
        'EMAIL_DELIVERY_FAILED'
      );
    }
  }

  async getUserByPublicId(publicId) {
    const user = await prisma.user.findUnique({
      where: { publicId },
      include: { role: true },
    });
    if (!user) throw new AppError(404, 'User not found');
    return user;
  }

  async createEmailVerificationToken(userId) {
    await prisma.$executeRaw`DELETE FROM "EmailVerificationToken" WHERE "userId" = ${userId}`;
    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    await prisma.$executeRaw`
      INSERT INTO "EmailVerificationToken" ("publicId", "token", "userId", "expiresAt", "createdAt")
      VALUES (${crypto.randomUUID()}, ${token}, ${userId}, ${expiresAt}, NOW())
    `;

    return token;
  }

  isCustomerRole(roleName) {
    return roleName === 'CUSTOMER' || roleName === 'USER';
  }

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
        emailVerifiedAt: null,
      },
      include: { role: true },
    });

    const verifyToken = await this.createEmailVerificationToken(user.id);
    const actionUrl = `${config.frontend.customerUrl}/verify-email?token=${verifyToken}`;
    await this.sendAuthEmail({
      to: user.email,
      template: 'verify-email',
      context: {
        name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
        actionUrl,
      },
    });

    return {
      user: toPublicUser(user),
      requiresEmailVerification: true,
      message: 'Registration successful. Please verify your email before login.',
    };
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

    if (user.isActive === false) {
      throw new AppError(403, 'This account has been deactivated.');
    }

    if (this.isCustomerRole(user.role.name) && !user.emailVerifiedAt) {
      throw new AppError(
        403,
        'Email not verified. Please verify your email before logging in.',
        'EMAIL_NOT_VERIFIED'
      );
    }

    const payload = {
      id: user.publicId,
      email: user.email,
      role: user.role.name,
    };
    if (user.role.name === 'ADMIN_TEAM') {
      payload.adminModules = user.adminModules ?? null;
    }

    const token = generateToken(payload);

    return {
      user: toPublicUser(user),
      token,
    };
  }

  async getUserById(publicId) {
    const user = await prisma.user.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        accessMemberUntil: true,
        adminModules: true,
        role: { select: { name: true } },
      },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    const base = {
      id: user.publicId,
      email: user.email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      role: user.role.name,
      phone: user.phone,
      createdAt: user.createdAt,
      accessMemberUntil: user.accessMemberUntil?.toISOString() ?? null,
      accessMemberActive:
        user.accessMemberUntil != null && user.accessMemberUntil > new Date(),
    };
    if (user.role.name === 'ADMIN' || user.role.name === 'ADMIN_TEAM') {
      base.adminModules = user.adminModules ?? null;
    }
    return base;
  }

  async updateProfile(publicId, payload) {
    const updated = await prisma.user.update({
      where: { publicId },
      data: {
        ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
        ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
      },
      select: {
        publicId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: { select: { name: true } },
      },
    });

    return {
      id: updated.publicId,
      email: updated.email,
      firstName: updated.firstName ?? undefined,
      lastName: updated.lastName ?? undefined,
      phone: updated.phone ?? undefined,
      role: updated.role.name,
    };
  }

  async changePassword(publicId, currentPassword, newPassword) {
    const user = await this.getUserByPublicId(publicId);
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new AppError(400, 'Current password is incorrect');
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return { message: 'Password changed successfully' };
  }

  async listAddresses(publicId) {
    const user = await this.getUserByPublicId(publicId);
    const items = await prisma.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return items.map((a) => ({
      id: a.publicId,
      fullName: a.fullName ?? '',
      addressLine1: a.addressLine1 ?? a.street,
      addressLine2: a.addressLine2 ?? null,
      city: a.city,
      state: a.state,
      zipCode: a.zipCode,
      country: a.country,
      phoneNumber: a.phoneNumber ?? null,
      isDefault: a.isDefault,
    }));
  }

  async createAddress(publicId, payload) {
    const user = await this.getUserByPublicId(publicId);
    if (payload.isDefault) {
      await prisma.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }
    const created = await prisma.address.create({
      data: {
        userId: user.id,
        fullName: payload.fullName,
        addressLine1: payload.addressLine1,
        addressLine2: payload.addressLine2 ?? null,
        street: payload.addressLine1,
        city: payload.city,
        state: payload.state,
        zipCode: payload.zipCode,
        country: payload.country,
        phoneNumber: payload.phoneNumber,
        isDefault: Boolean(payload.isDefault),
      },
    });
    return { id: created.publicId };
  }

  async updateAddress(publicId, addressPublicId, payload) {
    const user = await this.getUserByPublicId(publicId);
    const address = await prisma.address.findFirst({
      where: { publicId: addressPublicId, userId: user.id },
    });
    if (!address) throw new AppError(404, 'Address not found');
    if (payload.isDefault) {
      await prisma.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }
    await prisma.address.update({
      where: { id: address.id },
      data: {
        ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
        ...(payload.addressLine1 !== undefined
          ? { addressLine1: payload.addressLine1, street: payload.addressLine1 }
          : {}),
        ...(payload.addressLine2 !== undefined ? { addressLine2: payload.addressLine2 } : {}),
        ...(payload.city !== undefined ? { city: payload.city } : {}),
        ...(payload.state !== undefined ? { state: payload.state } : {}),
        ...(payload.zipCode !== undefined ? { zipCode: payload.zipCode } : {}),
        ...(payload.country !== undefined ? { country: payload.country } : {}),
        ...(payload.phoneNumber !== undefined ? { phoneNumber: payload.phoneNumber } : {}),
        ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {}),
      },
    });
    return { message: 'Address updated' };
  }

  async deleteAddress(publicId, addressPublicId) {
    const user = await this.getUserByPublicId(publicId);
    const deleted = await prisma.address.deleteMany({
      where: { publicId: addressPublicId, userId: user.id },
    });
    if (deleted.count < 1) throw new AppError(404, 'Address not found');
    return { message: 'Address deleted' };
  }

  async forgotPassword(email) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

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

      const baseUrl = this.isCustomerRole(user.role?.name || '')
        ? config.frontend.customerUrl
        : config.frontend.adminUrl;
      const resetUrl = `${baseUrl}/reset-password?token=${raw}`;

      await this.sendAuthEmail({
        to: user.email,
        template: 'forgot-password',
        context: {
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
          actionUrl: resetUrl,
        },
      });

      return {
        message: 'If an account exists for this email, a reset link has been sent.',
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

  async verifyEmail(token) {
    const rows = await prisma.$queryRaw`
      SELECT id, "userId", "expiresAt", "usedAt"
      FROM "EmailVerificationToken"
      WHERE token = ${token}
      LIMIT 1
    `;

    const record = Array.isArray(rows) ? rows[0] : null;
    if (!record || record.usedAt || new Date(record.expiresAt) < new Date()) {
      throw new AppError(400, 'Invalid or expired verification token', 'INVALID_VERIFICATION_TOKEN');
    }

    await prisma.$transaction([
      prisma.$executeRaw`UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE id = ${record.userId}`,
      prisma.$executeRaw`UPDATE "EmailVerificationToken" SET "usedAt" = NOW() WHERE id = ${record.id}`,
    ]);

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (user) {
      await this.sendAuthEmail({
        to: user.email,
        template: 'welcome',
        context: {
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
          actionUrl: `${config.frontend.customerUrl}/dashboard`,
        },
      });
    }

    return { message: 'Email verified successfully' };
  }

  async resendVerification(email) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user || !this.isCustomerRole(user.role.name)) {
      return { message: 'If an account exists, a verification email has been sent.' };
    }

    if (user.emailVerifiedAt) {
      return { message: 'Email is already verified.' };
    }

    const token = await this.createEmailVerificationToken(user.id);
    const actionUrl = `${config.frontend.customerUrl}/verify-email?token=${token}`;

    await this.sendAuthEmail({
      to: user.email,
      template: 'verify-email',
      context: {
        name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
        actionUrl,
      },
    });

    return { message: 'Verification email sent.' };
  }
}

export const authService = new AuthService();
