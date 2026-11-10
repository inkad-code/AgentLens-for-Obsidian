import type { NormalizedPost } from "./domain";
import { redactPersistentUrl } from "./urls";

/** Shared retention policy for durable deliveries and write recovery. */
export function persistedPost(post: NormalizedPost): NormalizedPost {
  return { ...post, media: post.media.map(media => ({ ...media, downloadHeaders: undefined,
    sourceUrl: redactPersistentUrl(media.sourceUrl, media.downloadUrlExpiresAt),
    ...(media.thumbnailUrl ? { thumbnailUrl: redactPersistentUrl(media.thumbnailUrl, media.thumbnailExpiresAt) } : {}),
    ...(media.coverUrl ? { coverUrl: redactPersistentUrl(media.coverUrl) } : {})
  })) };
}
