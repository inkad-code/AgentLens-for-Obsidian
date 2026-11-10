import { expect, it, vi } from 'vitest';
import { postContentTags, type NormalizedPost } from '@/core/domain';
import { BulkSession } from '@/bulk/BulkSession';
import type { FetchPage } from '@/api/AgentLensApiClient';
const post: NormalizedPost = { platform: 'instagram', contentId: 'post', canonicalUrl: 'https://instagram.com/p/post',
  text: '#not-a-source-tag', tags: [], author: { id: 'creator', displayName: 'Creator' }, media: [] };
it('treats an explicit empty tag list as authoritative without re-extracting caption hashtags', () => {
  expect(postContentTags(post)).toEqual([]);
  expect(postContentTags({ ...post, tags: ['中文', 'art', '中文'] })).toEqual(['中文', 'art']);
  expect(postContentTags({ ...post, tags: undefined })).toEqual(['not-a-source-tag']);
});
it('does not hydrate false or legacy missing flags and retains failures for explicit retry', async () => {
  const session = new BulkSession();
  const page: FetchPage = { fetchId: 'page', mode: 'profile_page', platform: 'instagram', content: [post], page: null,
    usage: { charged: true, units: 1, remaining: 0 } };
  await session.load(null, async () => page);
  const loader = vi.fn(async () => { throw new Error('offline'); });
  await session.supplement('instagram:post', loader);
  expect(loader).not.toHaveBeenCalled();
  await session.load(null, async () => ({ ...page, content: [{ ...post, needSupplement: true }] }));
  await expect(session.supplement('instagram:post', loader)).rejects.toThrow('offline');
  expect(session.rows()[0]?.post.needSupplement).toBe(true);
  expect(session.usageReceipts()[0]?.units).toBe(1);
});
