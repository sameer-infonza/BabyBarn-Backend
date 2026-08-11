import { prisma } from '../lib/prisma.js';

/**
 * Read-only Store Credit activity for finance console (RBAC-001).
 * Surfaces refurbishment return credit awards without requiring the Returns module.
 */
export async function listStoreCreditActivity() {
  const rows = await prisma.returnRequest.findMany({
    where: { type: 'REFURBISHMENT' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      publicId: true,
      returnNumber: true,
      type: true,
      status: true,
      createdAt: true,
      creditAwarded: true,
      user: {
        select: {
          id: true,
          publicId: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      orderItem: {
        select: {
          id: true,
          publicId: true,
          price: true,
          memberPriceSnapshot: true,
          product: {
            select: {
              id: true,
              publicId: true,
              name: true,
              productType: true,
            },
          },
        },
      },
    },
  });

  return rows;
}
