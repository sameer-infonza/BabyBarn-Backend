/**
 * In-place copy update for Client Conversation123 homepage revisions.
 * Does not wipe slides or require a schema change.
 *
 *   node scripts/update-homepage-carousel-client-copy.js
 */
import { PrismaClient } from '@prisma/client';

const HERO_REWARD =
  'Join Farmhouse Friends and send your little ones’ gently worn pieces back to us, and receive 20% toward their next size up.';

async function run() {
  const prisma = new PrismaClient();
  try {
    const hero = await prisma.homepageCarouselSlide.updateMany({
      where: { slideType: 'HERO' },
      data: {
        rewardLabel: HERO_REWARD,
        secondaryCtaLabel: 'Join Farmhouse Friends',
        secondaryCtaHref: '/farmhouse-friends',
      },
    });

    const letter = await prisma.homepageCarouselSlide.updateMany({
      where: { slideType: 'LETTER' },
      data: {
        primaryCtaLabel: 'Read the full note',
        primaryCtaHref: '/blog#dear-parents',
        backgroundImageUrl: null,
      },
    });

    console.log(`Updated ${hero.count} HERO slide(s) and ${letter.count} LETTER slide(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Homepage carousel copy update failed:', error);
  process.exit(1);
});
