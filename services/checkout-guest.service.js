import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { generateCheckoutToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';

const GUEST_PASSWORD_BYTES = 32;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function toGuestPublicUser(user) {
  return {
    id: user.publicId,
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    role: 'CUSTOMER',
    isGuest: true,
    accessMemberActive: false,
    accessMemberUntil: null,
  };
}

export class CheckoutGuestService {
  async createGuestSession({ email, firstName, lastName, phone }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
      throw new AppError(400, 'A valid email is required');
    }

    const existing = await prisma.user.findUnique({
      where: { email: normalized },
      include: { role: true },
    });

    if (existing) {
      if (existing.isActive === false) {
        throw new AppError(403, 'This account has been deactivated.');
      }
      if (!existing.isGuest) {
        throw new AppError(
          409,
          'An account with this email already exists. Please sign in to continue checkout.',
          'ACCOUNT_EXISTS'
        );
      }

      const updates = {};
      if (firstName?.trim()) updates.firstName = firstName.trim();
      if (lastName?.trim()) updates.lastName = lastName.trim();
      if (phone?.trim()) updates.phone = phone.trim();

      const user =
        Object.keys(updates).length > 0
          ? await prisma.user.update({
              where: { id: existing.id },
              data: updates,
              include: { role: true },
            })
          : existing;

      return this.issueCheckoutSession(user);
    }

    const hashedPassword = await bcrypt.hash(
      crypto.randomBytes(GUEST_PASSWORD_BYTES).toString('hex'),
      10
    );
    const defaultRole =
      (await prisma.role.findUnique({ where: { name: 'CUSTOMER' } })) ||
      (await prisma.role.findUnique({ where: { name: 'USER' } }));
    if (!defaultRole) {
      throw new AppError(500, 'Role configuration missing', 'ROLE_CONFIG_ERROR');
    }

    const user = await prisma.user.create({
      data: {
        email: normalized,
        password: hashedPassword,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        phone: phone?.trim() || null,
        roleId: defaultRole.id,
        isGuest: true,
        guestCreatedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
      include: { role: true },
    });

    return this.issueCheckoutSession(user);
  }

  issueCheckoutSession(user) {
    const token = generateCheckoutToken({
      id: user.publicId,
      email: user.email,
      role: user.role?.name || 'CUSTOMER',
    });
    return {
      user: toGuestPublicUser(user),
      token,
      checkoutScope: true,
    };
  }
}

export const checkoutGuestService = new CheckoutGuestService();
