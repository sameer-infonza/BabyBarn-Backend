import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
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
          data: { userId: user.id, balance: 0 },
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
        transactions: [],
      };
    }
    return wallet;
  }
}

export const walletService = new WalletService();
