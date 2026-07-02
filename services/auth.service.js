import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { generateToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';
import { emailService } from './email.service.js';
import { addressVerificationService } from './address-verification.service.js';
import { config } from '../config/env.js';

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  try {
    await prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return token;
  } catch (error) {
    if (error && typeof error === 'object' && (error.code === 'P2021' || error.code === 'P2022')) {
      return null;
    }
    throw error;
  }
}

function normalizeDateOfBirth(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeChildren(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((child) => {
      const name = typeof child?.name === 'string' ? child.name.trim() : '';
      const birthday = typeof child?.birthday === 'string' ? child.birthday.trim() : '';
      const stage = typeof child?.stage === 'string' ? child.stage.trim() : '';
      if (!name && !birthday && !stage) return null;
      const id =
        typeof child?.id === 'string' && child.id.trim()
          ? child.id.trim()
          : crypto.randomUUID();
      return { id, name, birthday, stage };
    })
    .filter(Boolean)
    .slice(0, 12);
}

import { normalizeNotificationPrefs } from '../lib/notification-prefs.js';

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
    accessNumber: user.accessNumber ?? undefined,
    babyName: user.babyName ?? undefined,
    avatarUrl: user.avatarUrl ?? null,
    dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString() : null,
    children: normalizeChildren(user.children),
    notificationPrefs: normalizeNotificationPrefs(user.notificationPrefs),
    membershipShippingAddressJson: user.membershipShippingAddressJson ?? undefined,
    isGuest: Boolean(user.isGuest),
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
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
      if (existingUser.isGuest) {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            password: hashedPassword,
            firstName: firstName?.trim() || existingUser.firstName,
            lastName: lastName?.trim() || existingUser.lastName,
            isGuest: false,
            convertedAt: new Date(),
            emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
          },
          include: { role: true },
        });

        const payload = {
          id: user.publicId,
          email: user.email,
          role: user.role.name,
        };
        const token = generateToken(payload);
        const refreshToken = await issueRefreshToken(user.id);

        return {
          user: toPublicUser(user),
          token,
          ...(refreshToken ? { refreshToken } : {}),
          convertedFromGuest: true,
          message: 'Account created. Your previous guest orders are now in your dashboard.',
        };
      }
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
        email: normalizedEmail,
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

    if (user.isGuest) {
      throw new AppError(
        403,
        'This email was used for guest checkout. Please complete registration to set a password.',
        'GUEST_ACCOUNT'
      );
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
    const refreshToken = await issueRefreshToken(user.id);

    return {
      user: toPublicUser(user),
      token,
      ...(refreshToken ? { refreshToken } : {}),
    };
  }

  async refreshAccessToken(refreshTokenRaw) {
    if (!refreshTokenRaw || typeof refreshTokenRaw !== 'string') {
      throw new AppError(401, 'Refresh token required', 'REFRESH_TOKEN_REQUIRED');
    }
    const tokenHash = hashRefreshToken(refreshTokenRaw.trim());
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { role: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) {
      throw new AppError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }
    if (row.user.isActive === false) {
      throw new AppError(403, 'This account has been deactivated.');
    }

    const payload = {
      id: row.user.publicId,
      email: row.user.email,
      role: row.user.role.name,
    };
    if (row.user.role.name === 'ADMIN_TEAM') {
      payload.adminModules = row.user.adminModules ?? null;
    }

    return {
      user: toPublicUser(row.user),
      token: generateToken(payload),
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
        accessNumber: true,
        babyName: true,
        avatarUrl: true,
        dateOfBirth: true,
        children: true,
        notificationPrefs: true,
        membershipShippingAddressJson: true,
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
      accessNumber: user.accessNumber ?? undefined,
      babyName: user.babyName ?? undefined,
      avatarUrl: user.avatarUrl ?? null,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
      children: normalizeChildren(user.children),
      notificationPrefs: normalizeNotificationPrefs(user.notificationPrefs),
      membershipShippingAddressJson: user.membershipShippingAddressJson ?? undefined,
    };
    if (user.role.name === 'ADMIN' || user.role.name === 'ADMIN_TEAM') {
      base.adminModules = user.adminModules ?? null;
    }
    return base;
  }

  async updateProfile(publicId, payload) {
    const data = {
      ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
      ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
      ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
      ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl || null } : {}),
    };

    if (payload.dateOfBirth !== undefined) {
      data.dateOfBirth = normalizeDateOfBirth(payload.dateOfBirth);
    }
    if (payload.children !== undefined) {
      data.children = normalizeChildren(payload.children);
    }
    if (payload.notificationPrefs !== undefined) {
      data.notificationPrefs = normalizeNotificationPrefs(payload.notificationPrefs);
    }

    const updated = await prisma.user.update({
      where: { publicId },
      data,
      select: {
        publicId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        dateOfBirth: true,
        children: true,
        notificationPrefs: true,
        role: { select: { name: true } },
      },
    });

    return {
      id: updated.publicId,
      email: updated.email,
      firstName: updated.firstName ?? undefined,
      lastName: updated.lastName ?? undefined,
      phone: updated.phone ?? undefined,
      avatarUrl: updated.avatarUrl ?? null,
      dateOfBirth: updated.dateOfBirth ? updated.dateOfBirth.toISOString() : null,
      children: normalizeChildren(updated.children),
      notificationPrefs: normalizeNotificationPrefs(updated.notificationPrefs),
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

  /** Side-effect-free check used by the security page to validate the current password live. */
  async verifyCurrentPassword(publicId, currentPassword) {
    const user = await this.getUserByPublicId(publicId);
    const valid = await bcrypt.compare(currentPassword || '', user.password);
    return { valid };
  }

  async changeEmail(publicId, newEmail, currentPassword) {
    const user = await this.getUserByPublicId(publicId);
    const ok = await bcrypt.compare(currentPassword || '', user.password);
    if (!ok) throw new AppError(400, 'Current password is incorrect');

    const normalizedEmail = String(newEmail || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new AppError(400, 'Enter a valid email address');
    }
    if (normalizedEmail === user.email.toLowerCase()) {
      throw new AppError(400, 'That is already your email address');
    }
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing && existing.id !== user.id) {
      throw new AppError(400, 'That email is already in use');
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: normalizedEmail, emailVerifiedAt: null },
      include: { role: true },
    });

    // Send a verification link to the new address (best-effort).
    try {
      const verifyToken = await this.createEmailVerificationToken(user.id);
      const actionUrl = `${config.frontend.customerUrl}/verify-email?token=${verifyToken}`;
      await this.sendAuthEmail({
        to: updated.email,
        template: 'verify-email',
        context: {
          name: [updated.firstName, updated.lastName].filter(Boolean).join(' ').trim(),
          actionUrl,
        },
      });
    } catch (err) {
      console.error('[auth] change-email verification send failed', err);
    }

    return {
      user: toPublicUser(updated),
      message: 'Email updated. Please check your inbox to verify the new address.',
    };
  }

  async pauseAccount(publicId, currentPassword) {
    const user = await this.getUserByPublicId(publicId);
    const ok = await bcrypt.compare(currentPassword || '', user.password);
    if (!ok) throw new AppError(400, 'Current password is incorrect');

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    // Revoke refresh tokens so the paused account is signed out everywhere.
    try {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    } catch (err) {
      console.error('[auth] pause-account token revoke failed', err);
    }
    return {
      message:
        'Your account is paused and you have been signed out. Contact support when you would like to reactivate it.',
    };
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

  /**
   * Run carrier address validation (no-op unless USPS/UPS credentials are set).
   * Returns the (possibly standardized) address fields to persist. In strict mode
   * an undeliverable address is rejected; otherwise we save what the user entered.
   */
  async _applyAddressVerification(payload) {
    const result = await addressVerificationService.verifyAddress({
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2 ?? null,
      city: payload.city,
      state: payload.state,
      zipCode: payload.zipCode,
      country: payload.country,
    });

    if (
      result.status === 'unverified' &&
      result.deliverable === false &&
      config.addressVerification.strict
    ) {
      throw new AppError(
        400,
        result.messages[0] || 'We could not verify this address. Please check it and try again.'
      );
    }

    if (result.normalized && (result.status === 'corrected' || result.status === 'verified')) {
      return {
        addressLine1: result.normalized.addressLine1 ?? payload.addressLine1,
        addressLine2: result.normalized.addressLine2 ?? payload.addressLine2 ?? null,
        city: result.normalized.city ?? payload.city,
        state: result.normalized.state ?? payload.state,
        zipCode: result.normalized.zipCode ?? payload.zipCode,
        country: result.normalized.country ?? payload.country,
      };
    }

    return {
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2 ?? null,
      city: payload.city,
      state: payload.state,
      zipCode: payload.zipCode,
      country: payload.country,
    };
  }

  async createAddress(publicId, payload) {
    const user = await this.getUserByPublicId(publicId);
    if (payload.isDefault) {
      await prisma.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }
    const verified = await this._applyAddressVerification(payload);
    const created = await prisma.address.create({
      data: {
        userId: user.id,
        fullName: payload.fullName,
        addressLine1: verified.addressLine1,
        addressLine2: verified.addressLine2,
        street: verified.addressLine1,
        city: verified.city,
        state: verified.state,
        zipCode: verified.zipCode,
        country: verified.country,
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
