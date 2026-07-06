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

function availableBalance(wallet) {
  return Math.max(0, Number(wallet.balance) - Number(wallet.heldBalance ?? 0));
}

async function ensureWallet(tx, userId) {
  return tx.storeCreditWallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: 0, heldBalance: 0 },
  });
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
    const capped = Math.round(Number(amount) * 100) / 100;
    if (capped <= 0) return 0;

    return prisma.$transaction(async (tx) => {
      const wallet = await ensureWallet(tx, userId);
      const available = availableBalance(wallet);
      const toHold = Math.min(capped, available);
      if (toHold <= 0) {
        throw new AppError(400, 'Insufficient store credit balance', 'STORE_CREDIT_INSUFFICIENT');
      }

      await tx.storeCreditWallet.update({
        where: { id: wallet.id },
        data: { heldBalance: { increment: toHold } },
      });
      await tx.storeCreditTransaction.create({
        data: {
          walletId: wallet.id,
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
    const capped = Math.round(Number(amount) * 100) / 100;
    if (capped <= 0) return;

    await prisma.$transaction(async (tx) => {
      await this.captureHoldInTx(tx, userId, capped, orderPublicId);
    });
  }

  async captureHoldInTx(tx, userId, amount, orderPublicId) {
    const wallet = await tx.storeCreditWallet.findUnique({ where: { userId } });
    if (!wallet || amount <= 0) return;

    const releaseHeld = Math.min(Number(wallet.heldBalance), amount);
    if (releaseHeld <= 0) return;

    await tx.storeCreditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: releaseHeld },
        heldBalance: { decrement: releaseHeld },
      },
    });
    await tx.storeCreditTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'REDEEMED',
        amount: -releaseHeld,
        orderPublicId,
        note: `Redeemed on paid order ${orderPublicId}`,
      },
    });
  }

  /** Release held credit when checkout fails or is abandoned. */
  async releaseHold(userId, amount, orderPublicId) {
    const capped = Math.round(Number(amount) * 100) / 100;
    if (capped <= 0) return;

    await prisma.$transaction(async (tx) => {
      await this.releaseHoldInTx(tx, userId, capped, orderPublicId);
    });
  }

  async releaseHoldInTx(tx, userId, amount, orderPublicId) {
    const wallet = await tx.storeCreditWallet.findUnique({ where: { userId } });
    if (!wallet || amount <= 0) return;

    const toRelease = Math.min(Number(wallet.heldBalance), amount);
    if (toRelease <= 0) return;

    await tx.storeCreditWallet.update({
      where: { id: wallet.id },
      data: { heldBalance: { decrement: toRelease } },
    });
    await tx.storeCreditTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'RELEASE',
        amount: toRelease,
        orderPublicId,
        note: `Released hold for order ${orderPublicId}`,
      },
    });
  }

  /** Restore store credit that was redeemed on a paid order being cancelled. */
  async refundRedeemedCreditInTx(tx, userId, amount, orderPublicId) {
    const capped = Math.round(Number(amount) * 100) / 100;
    if (capped <= 0) return;

    const wallet = await ensureWallet(tx, userId);
    await tx.storeCreditWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: capped } },
    });
    await tx.storeCreditTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'ADJUSTED',
        amount: capped,
        orderPublicId,
        note: `Restored after order ${orderPublicId} cancellation`,
      },
    });
  }
}

export const walletService = new WalletService();
