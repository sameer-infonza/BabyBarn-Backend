import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { generateCheckoutToken } from '../utils/jwt.js';
import { AppError } from '../utils/error-handler.js';
import { PORTAL_SCOPE, findUserByEmailAndPortal, normalizeAuthEmail } from '../lib/portal-scope.js';

const GUEST_PASSWORD_BYTES = 32;

function toGuestPublicUser(user, contactEmailOverride) {
  return {
    id: user.publicId,
    email: contactEmailOverride || user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    role: 'CUSTOMER',
    portalScope: PORTAL_SCOPE.CUSTOMER,
    isGuest: true,
    accessMemberActive: false,
    accessMemberUntil: null,
  };
}

export class CheckoutGuestService {
  async createGuestSession({ email, firstName, lastName, phone, continueAsGuest = false }) {
    const normalized = normalizeAuthEmail(email);
    if (!normalized || !normalized.includes('@')) {
      throw new AppError(400, 'A valid email is required');
    }

    const existing = await findUserByEmailAndPortal(prisma, normalized, PORTAL_SCOPE.CUSTOMER, {
      include: { role: true },
    });

    if (existing) {
      if (existing.isActive === false) {
        throw new AppError(403, 'This account has been deactivated.');
      }
      if (!existing.isGuest) {
        if (!continueAsGuest) {
          throw new AppError(
            409,
            'An account with this email already exists. Please sign in to continue checkout.',
            'ACCOUNT_EXISTS'
          );
        }
        // Ephemeral guest shell: do not bind to the registered account.
        // Receipts use contactEmail on the intent/order (typed email).
        return this.createEphemeralGuestSession({
          contactEmail: normalized,
          firstName,
          lastName,
          phone,
        });
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

      return this.issueCheckoutSession(user, normalized);
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
        portalScope: PORTAL_SCOPE.CUSTOMER,
        isGuest: true,
        guestCreatedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
      include: { role: true },
    });

    return this.issueCheckoutSession(user, normalized);
  }

  async createEphemeralGuestSession({ contactEmail, firstName, lastName, phone }) {
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

    const shellEmail = `checkout+${crypto.randomUUID().replace(/-/g, '')}@guest.local`;
    const user = await prisma.user.create({
      data: {
        email: shellEmail,
        password: hashedPassword,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        phone: phone?.trim() || null,
        roleId: defaultRole.id,
        portalScope: PORTAL_SCOPE.CUSTOMER,
        isGuest: true,
        guestCreatedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
      include: { role: true },
    });

    return this.issueCheckoutSession(user, contactEmail);
  }

  issueCheckoutSession(user, contactEmailOverride) {
    const token = generateCheckoutToken({
      id: user.publicId,
      email: contactEmailOverride || user.email,
      role: user.role?.name || 'CUSTOMER',
      portalScope: PORTAL_SCOPE.CUSTOMER,
    });
    return {
      user: toGuestPublicUser(user, contactEmailOverride),
      token,
      checkoutScope: true,
    };
  }
}

export const checkoutGuestService = new CheckoutGuestService();
