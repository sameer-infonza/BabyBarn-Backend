import { prisma } from '../lib/prisma.js';

const emails = ['admin@babyburn.local', 'demo@babyburn.local'];

const result = await prisma.user.updateMany({
  where: { email: { in: emails }, emailVerifiedAt: null },
  data: { emailVerifiedAt: new Date() },
});

console.log(`[OK] Marked ${result.count} seed user(s) as email-verified.`);

await prisma.$disconnect();
