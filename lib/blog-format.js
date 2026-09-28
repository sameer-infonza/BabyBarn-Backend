export const BLOG_VIEW_COOKIE = 'bb_blog_seen';
const WORDS_PER_MINUTE = 200;

export function slugifyBlog(value) {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'article';
}

export function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingTimeMinutes(html) {
  const words = plainTextFromHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export function parseSeenBlogSlugs(cookieHeader) {
  const raw = String(cookieHeader || '');
  const match = raw.match(new RegExp(`(?:^|;\\s*)${BLOG_VIEW_COOKIE}=([^;]*)`));
  if (!match) return [];
  return decodeURIComponent(match[1])
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function seenBlogCookieValue(slugs) {
  const unique = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))].slice(-40);
  return `${BLOG_VIEW_COOKIE}=${encodeURIComponent(unique.join(','))}; Path=/; HttpOnly; SameSite=Lax`;
}

export function authorLabel(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || null;
}
