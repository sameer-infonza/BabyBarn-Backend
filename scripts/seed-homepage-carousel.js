/**
 * Idempotent seed for homepage Section 1 carousel (design HTML defaults).
 * Creates the 4 design slides only when the table is empty.
 *
 * Usage:
 *   node scripts/seed-homepage-carousel.js
 *   node scripts/seed-homepage-carousel.js --force   # delete all slides, re-create design defaults
 *   npm run seed:homepage-carousel
 */
import { PrismaClient } from '@prisma/client';

const HERO_BODY =
  'Our collections are thoughtfully designed for those early years. Made from 100% organic cotton in a GOTS Certified facility, our pieces are soft, durable enough for real life, and rooted in a farmhouse spirit that feels both timeless and warm. These are pieces made for living, not just looking.\n\nBut the magic doesn’t stop when they outgrow them.';

const LETTER_BODY = [
  'Congratulations and welcome to the wildest, and most wonderful journey of your life. There is nothing more transformative than the moment you realize you are expecting and we are sending you all the good vibes as you embark on this next chapter. We see you and no matter what your path to becoming a parent looks like, we are so glad to have you here.',
  'At Baby Barn, we’re a team of parents…. rooting for other parents. We know that there are infinite decisions to be made and behind every upcoming milestone are incalculable amounts of excitement, patience, hard work and hope. We encourage you to continue to lean on your instincts and know that in this moment, you have and are everything that your little one is hoping for. It sounds cheesy, we know. We also know that one day, you’ll look back and know that it’s true :)',
  'With that being said, Cheers to you, your little one, and your blossoming family. Here’s to the joy, the decisions big and small, and the everyday moments in between.',
].join('\n\n');

const PRODUCTS_EVERYDAY = [
  {
    customName: 'Organic Cotton Short Sleeve Onesie – White',
    customCategory: 'Onesies',
    customMemberPrice: 9.99,
    customFullPrice: 14.99,
    placeholderBg: '#f6f1e6',
    sortOrder: 0,
  },
  {
    customName: 'Baby Zip Pajama – Little Clouds Collection',
    customCategory: 'Refurbished',
    customMemberPrice: 17.84,
    customFullPrice: 24.0,
    placeholderBg: '#d6f0ff',
    isRefurbished: true,
    sortOrder: 1,
  },
  {
    customName: 'Organic Kimono Bodysuit – Sage Green',
    customCategory: 'Kimono bodysuits',
    customMemberPrice: 12.99,
    customFullPrice: 16.99,
    placeholderBg: '#e7f2e6',
    sortOrder: 2,
  },
  {
    customName: 'The kids long sleeve swim top',
    customCategory: 'Swim',
    customMemberPrice: 8.0,
    customFullPrice: 10.0,
    placeholderBg: '#e9e2f7',
    sortOrder: 3,
  },
];

const PRODUCTS_SLEEP = [
  {
    customName: 'Two-Piece Pajama Set – Little Clouds',
    customCategory: 'Sleepwear',
    customMemberPrice: 22.99,
    customFullPrice: 29.99,
    placeholderBg: '#d6f0ff',
    sortOrder: 0,
  },
  {
    customName: 'Organic Sleep Sack – Oat',
    customCategory: 'Sleepwear',
    customMemberPrice: 26.0,
    customFullPrice: 34.0,
    placeholderBg: '#f6f1e6',
    sortOrder: 1,
  },
  {
    customName: 'Zip Sleeper – Sage Green',
    customCategory: 'Sleepwear',
    customMemberPrice: 18.5,
    customFullPrice: 24.0,
    placeholderBg: '#e7f2e6',
    sortOrder: 2,
  },
  {
    customName: 'Long Sleeve Pajama – Stars (Refurbished)',
    customCategory: 'Refurbished',
    customMemberPrice: 14.2,
    customFullPrice: 24.0,
    placeholderBg: '#fffbcc',
    isRefurbished: true,
    sortOrder: 3,
  },
];

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ force?: boolean }} [options]
 */
export async function seedHomepageCarousel(prisma, options = {}) {
  const force = Boolean(options.force);
  const existing = await prisma.homepageCarouselSlide.count();

  if (existing > 0 && !force) {
    console.log(`[SKIP] homepage carousel already has ${existing} slide(s)`);
    return { created: 0, skipped: existing, forced: false };
  }

  if (existing > 0 && force) {
    await prisma.homepageCarouselProductCard.deleteMany({});
    await prisma.homepageCarouselSlide.deleteMany({});
    console.log(`[RESET] removed ${existing} existing homepage carousel slide(s)`);
  }

  await prisma.homepageCarouselSlide.create({
    data: {
      sortOrder: 0,
      isActive: true,
      slideType: 'HERO',
      backgroundTone: 'cream',
      chipLabel: '100% organic cotton · GOTS certified',
      title: 'Tiny clothes.\nBig(ger) Impact.',
      bodyText: HERO_BODY,
      rewardPercent: '20%',
      rewardLabel:
        'Send your little one’s gently worn pieces back to us, and receive 20% toward their next size up as a reward for doing good.',
      primaryCtaLabel: 'Shop the collection',
      primaryCtaHref: '/products',
      secondaryCtaLabel: 'How the return program works',
      secondaryCtaHref: '/how-it-works',
      imageLabel1: 'hero — baby in organic cotton',
      imageLabel2: 'detail — fabric',
    },
  });

  await prisma.homepageCarouselSlide.create({
    data: {
      sortOrder: 1,
      isActive: true,
      slideType: 'PRODUCT_GRID',
      backgroundTone: 'cream',
      eyebrow: 'Shop preview',
      title: 'Everyday essentials',
      subtitle: 'New and expertly re-conditioned pieces, side by side. Members pay less on every one.',
      primaryCtaLabel: 'View all items',
      primaryCtaHref: '/products',
      productCards: { create: PRODUCTS_EVERYDAY },
    },
  });

  await prisma.homepageCarouselSlide.create({
    data: {
      sortOrder: 2,
      isActive: true,
      slideType: 'LETTER',
      backgroundTone: 'purple',
      eyebrow: 'A note from the barn',
      title: 'Dear Parents and\nSoon-to-be-Parents,',
      bodyText: LETTER_BODY,
      signatureName: 'You got this!',
      signatureFrom: 'Sincerely,\nTeam Baby Barn',
    },
  });

  await prisma.homepageCarouselSlide.create({
    data: {
      sortOrder: 3,
      isActive: true,
      slideType: 'PRODUCT_GRID',
      backgroundTone: 'blue-soft',
      eyebrow: 'Sleepwear',
      title: 'Soft enough for the long nights',
      subtitle:
        'Breathable organic cotton pajamas, sleep sacks and zip-ups — built for washing, growing and passing on.',
      primaryCtaLabel: 'View all items',
      primaryCtaHref: '/products',
      productCards: { create: PRODUCTS_SLEEP },
    },
  });

  console.log('[CREATE] homepage carousel: 4 default slides (hero, shop, letter, sleepwear)');
  return { created: 4, skipped: 0, forced: force };
}

async function runCli() {
  const force = process.argv.includes('--force');
  const prisma = new PrismaClient();
  try {
    const result = await seedHomepageCarousel(prisma, { force });
    console.log('\nHomepage carousel seed summary');
    console.log(`created: ${result.created}, skipped: ${result.skipped}, forced: ${result.forced}`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('seed-homepage-carousel.js') ||
    process.argv[1].includes('seed-homepage-carousel'));

if (isDirectRun) {
  runCli().catch((error) => {
    console.error('Homepage carousel seed failed:', error);
    process.exit(1);
  });
}
