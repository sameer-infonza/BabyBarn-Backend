import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSeenBlogSlugs,
  readingTimeMinutes,
  seenBlogCookieValue,
  slugifyBlog,
} from '../lib/blog-format.js';

test('slugifyBlog keeps seo-friendly slugs', () => {
  assert.equal(slugifyBlog('Dear Parents and Soon-to-be-Parents'), 'dear-parents-and-soon-to-be-parents');
  assert.equal(slugifyBlog(''), 'article');
});

test('reading time is at least one minute', () => {
  assert.equal(readingTimeMinutes('<p>Hello world</p>'), 1);
  const long = `<p>${'word '.repeat(450)}</p>`;
  assert.equal(readingTimeMinutes(long), 3);
});

test('view cookie remembers a slug once per session list', () => {
  const header = seenBlogCookieValue(['dear-parents']).split(';')[0];
  assert.deepEqual(parseSeenBlogSlugs(header), ['dear-parents']);
  assert.deepEqual(parseSeenBlogSlugs(`${header}; other=1`), ['dear-parents']);
});
