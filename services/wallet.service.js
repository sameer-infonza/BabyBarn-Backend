import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
}

function isUniqueViolation(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'P2002');
}

function moneyRound(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function availableBalance(wallet) {
  return Math.max(0, Number(wallet.balance) - Number(wallet.heldBalance ?? 0));
}

/** Natural idempotency key for refurb inspection earn events. */
export function refurbEarnSourceKey(returnPublicId) {
  return `earn:return:${String(returnPublicId || '').trim()}`;
}

async function ensureWallet(tx, userId) {
  return tx.storeCreditWallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: 0, heldBalance: 0 },
  });
}

async function lockWalletRow(tx, walletId) {
  await tx.$queryRaw`
    SELECT id FROM "StoreCreditWallet" WHERE id = ${walletId} FOR UPDATE
  `;
  return tx.storeCreditWallet.findUnique({ where: { id: walletId } });
}

/**
 * Award earned store credit exactly once for a sourceKey (inside an existing transaction).
 * Returns { amount, created, skipped }.
 */
export async function awardEarnedCreditInTx(
  tx,
  { userId, amount, sourceKey, note = null, orderPublicId = null }
) {
  const capped = moneyRound(amount);
  const key = String(sourceKey || '').trim();
  if (!key) {
    throw new AppError(500, 'Store credit earn requires a sourceKey', 'STORE_CREDIT_SOURCE_REQUIRED');
  }
  if (capped <= 0) {
    return { amount: 0, created: false, skipped: true };
  }

  const existing = await tx.storeCreditTransaction.findUnique({
    where: { sourceKey: key },
  });
  if (existing) {
    return { amount: moneyRound(existing.amount), created: false, skipped: true, transaction: existing };
  }

  const wallet = await ensureWallet(tx, userId);
  const locked = await lockWalletRow(tx, wallet.id);
  if (!locked) {
    throw new AppError(500, 'Store credit wallet missing after upsert', 'STORE_CREDIT_WALLET_MISSING');
  }

  try {
    const transaction = await tx.storeCreditTransaction.create({
      data: {
        walletId: locked.id,
        type: 'EARNED',
        amount: capped,
        sourceKey: key,
        note: note ? String(note) : null,
        orderPublicId: orderPublicId || null,
      },
    });
    await tx.storeCreditWallet.update({
      where: { id: locked.id },
      data: { balance: { increment: capped } },
    });
    return { amount: capped, created: true, skipped: false, transaction };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await tx.storeCreditTransaction.findUnique({ where: { sourceKey: key } });
    return {
      amount: moneyRound(raced?.amount ?? capped),
      created: false,
      skipped: true,
      transaction: raced,
    };
  }
}

export class WalletService {
  async getWallet(userPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');

    let wallet = null;
    try {
      wallet = await prisma.storeCreditWallet.findUnique({
        where: { userId: user.id },
        include: { transactions: { orderBy: { createdAt: 'desc' }, take: 100 } },
      });
      if (!wallet) {
        wallet = await prisma.storeCreditWallet.create({
          data: { userId: user.id, balance: 0, heldBalance: 0 },
          include: { transactions: true },
        });
      }
    } catch (error) {
      if (!isMissingWalletTableError(error)) {
        throw error;
      }
      return {
        publicId: 'wallet-migration-pending',
        userId: user.id,
        balance: 0,
        heldBalance: 0,
        availableBalance: 0,
        transactions: [],
      };
    }
    return {
      ...wallet,
      availableBalance: Math.max(0, Number(wallet.balance) - Number(wallet.heldBalance ?? 0)),
    };
  }

  /** Reserve store credit at checkout — not deducted from spendable balance until payment succeeds. */
  async holdCredit(userId, amount, orderPublicId) {
    const capped = moneyRound(amount);
    if (capped <= 0) return 0;

    return prisma.$transaction(async (tx) => {
      const wallet = await ensureWallet(tx, userId);
      const locked = await lockWalletRow(tx, wallet.id);
      const available = availableBalance(locked);
      const toHold = Math.min(capped, available);
      if (toHold <= 0) {
        throw new AppError(400, 'Insufficient store credit balance', 'STORE_CREDIT_INSUFFICIENT');
      }

      await tx.storeCreditWallet.update({
        where: { id: locked.id },
        data: { heldBalance: { increment: toHold } },
      });
      await tx.storeCreditTransaction.create({
        data: {
          walletId: locked.id,
          type: 'HOLD',
          amount: -toHold,
          orderPublicId,
          note: `Held for checkout order ${orderPublicId}`,
        },
      });
      return toHold;
    });
  }

  /** Commit held credit after successful payment. */
  async captureHold(userId, amount, orderPublicId) {
    const capped = moneyRound(amount);
    if (capped <= 0) return;

    await prisma.$transaction(async (tx) => {
      await this.captureHoldInTx(tx, userId, capped, orderPublicId);
    });
  }

  async captureHoldInTx(tx, userId, amount, orderPublicId) {
    const wallet = await tx.storeCreditWallet.findUnique({ where: { userId } });
    if (!wallet || amount <= 0) return;

    const locked = await lockWalletRow(tx, wallet.id);
    if (!locked) return;

    const releaseHeld = Math.min(Number(locked.heldBalance), amount);
    if (releaseHeld <= 0) return;

    await tx.storeCreditWallet.update({
      where: { id: locked.id },
      data: {
        balance: { decrement: releaseHeld },
        heldBalance: { decrement: releaseHeld },
      },
    });
    await tx.storeCreditTransaction.create({
      data: {
        walletId: locked.id,
        type: 'REDEEMED',
        amount: -releaseHeld,
        orderPublicId,
        note: `Redeemed on paid order ${orderPublicId}`,
      },
    });
  }

  /** Release held credit when checkout fails or is abandoned. */
  async releaseHold(userId, amount, orderPublicId) {
    const capped = moneyRound(amount);
    if (capped <= 0) return;

    await prisma.$transaction(async (tx) => {
      await this.releaseHoldInTx(tx, userId, capped, orderPublicId);
    });
  }

  async releaseHoldInTx(tx, userId, amount, orderPublicId) {
    const wallet = await tx.storeCreditWallet.findUnique({ where: { userId } });
    if (!wallet || amount <= 0) return;

    const locked = await lockWalletRow(tx, wallet.id);
    if (!locked) return;

    const toRelease = Math.min(Number(locked.heldBalance), amount);
    if (toRelease <= 0) return;

    await tx.storeCreditWallet.update({
      where: { id: locked.id },
      data: { heldBalance: { decrement: toRelease } },
    });
    await tx.storeCreditTransaction.create({
      data: {
        walletId: locked.id,
        type: 'RELEASE',
        amount: toRelease,
        orderPublicId,
        note: `Released hold for order ${orderPublicId}`,
      },
    });
  }

  /** Restore store credit that was redeemed on a paid order being cancelled. */
  async refundRedeemedCreditInTx(tx, userId, amount, orderPublicId, opts = {}) {
    const capped = moneyRound(amount);
    if (capped <= 0) return { restored: 0, skipped: true };

    const sourceKey =
      opts.sourceKey != null && String(opts.sourceKey).trim()
        ? String(opts.sourceKey).trim().slice(0, 190)
        : null;

    if (sourceKey) {
      const existing = await tx.storeCreditTransaction.findUnique({
        where: { sourceKey },
        select: { id: true, amount: true },
      });
      if (existing) {
        return { restored: Number(existing.amount) || 0, skipped: true };
      }
    }

    const wallet = await ensureWallet(tx, userId);
    const locked = await lockWalletRow(tx, wallet.id);
    try {
      await tx.storeCreditWallet.update({
        where: { id: locked.id },
        data: { balance: { increment: capped } },
      });
      await tx.storeCreditTransaction.create({
        data: {
          walletId: locked.id,
          type: 'ADJUSTED',
          amount: capped,
          orderPublicId,
          note: `Restored after order ${orderPublicId} cancellation`,
          ...(sourceKey ? { sourceKey } : {}),
        },
      });
    } catch (err) {
      if (sourceKey && err && typeof err === 'object' && err.code === 'P2002') {
        return { restored: capped, skipped: true };
      }
      throw err;
    }
    return { restored: capped, skipped: false };
  }
}

export const walletService = new WalletService();
