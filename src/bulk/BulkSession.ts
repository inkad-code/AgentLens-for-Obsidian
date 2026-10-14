import type { FetchPage } from "../api/AgentLensApiClient";
import type { PreviewResult } from "../workbench/types";
import { contentKey, postThumbnailUrl } from "../core/domain";

export class BulkSession {
  private readonly items = new Map<string, PreviewResult>();
  private readonly order: string[] = [];
  private readonly selectedKeys = new Set<string>();
  private readonly inFlight = new Map<string, Promise<FetchPage>>();
  private readonly details = new Map<string, Promise<PreviewResult>>();
  private readonly completeDetails = new Map<string, PreviewResult>();
  private generation = 0;
  private nextCursor: string | null = null;
  private readonly pageUsage: Array<{ fetchId: string; pageNumber: number; charged: boolean; units: number; remaining: number | null }> = [];

  async load(
    cursor: string | null,
    loader: (cursor: string | null) => Promise<FetchPage>
  ): Promise<FetchPage> {
    const scope = cursor ?? "first";
    const current = this.inFlight.get(scope);
    if (current) return current;
    const generation = this.generation;
    const request = loader(cursor).then((page) => {
      if (generation !== this.generation) throw new Error("The post list has changed. Please fetch it again.");
      if (page.page?.hasMore && (!page.page.cursor || page.page.cursor === cursor)) {
        throw new Error("The next page cursor is missing or did not advance. Please retry the page.");
      }
      this.append(page);
      return page;
    }).finally(() => {
      if (this.inFlight.get(scope) === request) this.inFlight.delete(scope);
    });
    this.inFlight.set(scope, request);
    return request;
  }

  /** A creator list may contain only article summaries. Hydrate once per loaded article. */
  async hydrate(key: string, loader: (url: string) => Promise<PreviewResult>): Promise<PreviewResult> {
    const current = this.items.get(key);
    if (!current) throw new Error("This post is no longer in the loaded list.");
    if (current.post.platform !== "wechat_official_account") return current;
    const complete = this.completeDetails.get(key);
    if (complete) return complete;
    const pending = this.details.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const request = loader(current.post.canonicalUrl).then(detail => {
      if (generation !== this.generation) throw new Error("The article list has changed. Please select the post again.");
      if (contentKey(detail.post) !== key) throw new Error("The article returned does not match the selected post. Nothing was saved.");
      const body = detail.post.body?.trim() || detail.post.text.trim();
      if (!body || body === detail.post.title?.trim() || body === current.post.text.trim() && !body.includes("\n")) throw new Error("The full article was not returned. Please retry before saving.");
      const hydrated = { ...detail, post: { ...detail.post,
        thumbnailUrl: postThumbnailUrl(current.post) ?? postThumbnailUrl(detail.post) } };
      this.items.set(key, hydrated);
      this.completeDetails.set(key, hydrated);
      return hydrated;
    }).finally(() => { if (this.details.get(key) === request) this.details.delete(key); });
    this.details.set(key, request);
    return request;
  }

  reset(): void {
    this.generation += 1;
    this.inFlight.clear();
    this.details.clear();
    this.completeDetails.clear();
    this.items.clear();
    this.order.length = 0;
    this.selectedKeys.clear();
    this.nextCursor = null;
    this.pageUsage.length = 0;
  }

  toggle(key: string): void {
    if (!this.items.has(key)) return;
    if (this.selectedKeys.has(key)) this.selectedKeys.delete(key);
    else this.selectedKeys.add(key);
  }

  selectAll(keys?: readonly string[]): void {
    const candidates = keys ?? this.order;
    for (const key of candidates) {
      if (this.items.has(key)) this.selectedKeys.add(key);
    }
  }

  selectOnly(keys: readonly string[]): void {
    this.selectedKeys.clear();
    this.selectAll(keys);
  }

  clearSelection(): void {
    this.selectedKeys.clear();
  }

  rows(): readonly PreviewResult[] {
    return this.order.map((key) => this.items.get(key)).filter((value): value is PreviewResult => Boolean(value));
  }

  selected(): readonly PreviewResult[] {
    return this.order
      .filter((key) => this.selectedKeys.has(key))
      .map((key) => this.items.get(key))
      .filter((value): value is PreviewResult => Boolean(value));
  }

  isSelected(key: string): boolean {
    return this.selectedKeys.has(key);
  }

  cursor(): string | null {
    return this.nextCursor;
  }

  usageReceipts(): readonly { fetchId: string; pageNumber: number; charged: boolean; units: number; remaining: number | null }[] {
    return this.pageUsage;
  }

  private append(page: FetchPage): void {
    for (const post of page.content) {
      const key = contentKey(post);
      if (!this.items.has(key)) this.order.push(key);
      this.items.set(key, this.completeDetails.get(key) ?? {
        post,
        fetchId: page.fetchId,
        usageRemaining: page.usage.remaining,
        usage: page.usage,
        demo: false
      });
    }
    if (!this.pageUsage.some((receipt) => receipt.fetchId === page.fetchId)) {
      this.pageUsage.push({
        fetchId: page.fetchId,
        pageNumber: page.page?.pageNumber ?? this.pageUsage.length + 1,
        charged: page.usage.charged,
        units: page.usage.units,
        remaining: page.usage.remaining
      });
    }
    this.nextCursor = page.page?.hasMore ? page.page.cursor : null;
  }
}
