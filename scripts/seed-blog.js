import { prisma } from '../lib/prisma.js';

const DEAR_PARENTS_HTML = `
<p>Congratulations and welcome to the wildest, and most wonderful journey of your life. There is nothing more transformative than the moment you realize you are expecting and we are sending you all the good vibes as you embark on this next chapter. We see you and no matter what your path to becoming a parent looks like, we are so glad to have you here.</p>
<p>At Baby Barn, we're a team of parents…. rooting for other parents. We know that there are infinite decisions to be made and behind every upcoming milestone are incalculable amounts of excitement, patience, hard work and hope. We encourage you to continue to lean on your instincts and know that in this moment, you have and are everything that your little one is hoping for. It sounds cheesy, we know. We also know that one day, you'll look back and know that it's true :)</p>
<p>With that being said, Cheers to you, your little one, and your blossoming family. Here's to the joy, the decisions big and small, and the everyday moments in between.</p>
<p><strong>You got this!</strong></p>
<p>Sincerely, Team Baby Barn</p>
`.trim();

export async function seedBlog(db = prisma) {
  await db.homepageCarouselSlide.updateMany({
    where: { primaryCtaHref: '/blog#dear-parents' },
    data: { primaryCtaHref: '/blog/dear-parents' },
  });

  const existing = await db.blogPost.findFirst({
    where: { slug: 'dear-parents', deletedAt: null },
    select: { id: true },
  });
  if (existing) return { created: 0, skipped: 1 };

  await db.blogPost.create({
    data: {
      slug: 'dear-parents',
      title: 'Dear Parents and Soon-to-be-Parents',
      excerpt:
        'A note from the Baby Barn team — congratulations, and welcome to the wildest and most wonderful journey of your life.',
      contentHtml: DEAR_PARENTS_HTML,
      authorName: 'Team Baby Barn',
      status: 'PUBLISHED',
      featured: true,
      publishedAt: new Date('2026-01-15T12:00:00.000Z'),
      seoTitle: 'Dear Parents and Soon-to-be-Parents',
      metaDescription:
        'A welcome note from Baby Barn for parents and soon-to-be parents.',
    },
  });
  return { created: 1, skipped: 0 };
}
