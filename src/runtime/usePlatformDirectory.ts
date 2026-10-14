import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Directory = { accountId: string; plan?: string } | { clientType: string };
export interface DirectoryResult<T> { data?: T; failed?: boolean }

// Object key order is irrelevant; array order (platform display order) is meaningful.
function contentKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    return item;
  });
}

/** Display-only cache. Keep this module identical in the Eagle and Obsidian plugins. */
export function usePlatformDirectory<T extends Directory>(options: {
  accountId?: string | undefined;
  installationId?: string | undefined;
  plan?: string | undefined;
  clientType: string;
  enabled: boolean;
  load: () => Promise<T>;
  ownerWindow: Window;
}) {
  const { accountId, installationId, plan, clientType, enabled, load, ownerWindow } = options;
  const scope = useMemo(() => ({}), [accountId, installationId, plan, clientType, enabled, load, ownerWindow]);
  const [stored, setStored] = useState<{ scope: object; result: DirectoryResult<T> }>();
  const currentRefresh = useRef<{ scope: object; run: (force: boolean) => Promise<void> } | undefined>(undefined);
  useEffect(() => {
    if (!enabled || accountId && !installationId) return;
    let active = true;
    let pending: Promise<void> | undefined;
    let nextRefreshAt = 0;
    let retryDelayMs = 60_000;
    let lastGoodData: T | undefined;
    let lastGoodKey: string | undefined;
    let failed = false;
    let timer: number | undefined;
    const clearTimer = () => { if (timer !== undefined) ownerWindow.clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      clearTimer();
      if (active && ownerWindow.document.visibilityState !== "hidden")
        timer = ownerWindow.setTimeout(() => { if (ownerWindow.document.visibilityState !== "hidden") void refresh(false); }, Math.max(0, nextRefreshAt - Date.now()));
    };
    const refresh = (force: boolean): Promise<void> => {
      if (!active) return Promise.resolve();
      if (pending) return pending;
      if (!force && Date.now() < nextRefreshAt) { schedule(); return Promise.resolve(); }
      clearTimer();
      pending = Promise.resolve().then(async () => {
        try {
          if (!active) return;
          const data = await load();
          if (!active) return;
          if (accountId ? !("accountId" in data) || data.accountId !== accountId || plan !== undefined && data.plan !== plan
            : "accountId" in data || data.clientType !== clientType)
            throw new Error("Platform directory scope mismatch");
          const nextKey = contentKey(data);
          const changed = nextKey !== lastGoodKey;
          if (changed) { lastGoodData = data; lastGoodKey = nextKey; }
          retryDelayMs = 60_000;
          nextRefreshAt = Date.now() + 300_000;
          // A successful revalidation renews TTL without replacing unchanged UI data.
          if (changed || failed) setStored({ scope, result: { data: lastGoodData! } });
          failed = false;
        } catch {
          if (!active) return;
          nextRefreshAt = Date.now() + retryDelayMs;
          retryDelayMs = Math.min(retryDelayMs * 2, 900_000);
          if (!failed) setStored({ scope, result: { ...(lastGoodData ? { data: lastGoodData } : {}), failed: true } });
          failed = true;
        } finally {
          pending = undefined;
          schedule();
        }
      });
      return pending;
    };
    currentRefresh.current = { scope, run: refresh };
    const visible = () => { if (ownerWindow.document.visibilityState === "hidden") clearTimer(); else void refresh(false); };
    void refresh(true);
    ownerWindow.addEventListener("focus", visible);
    ownerWindow.document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; clearTimer();
      if (currentRefresh.current?.scope === scope) currentRefresh.current = undefined;
      ownerWindow.removeEventListener("focus", visible);
      ownerWindow.document.removeEventListener("visibilitychange", visible);
    };
  }, [scope, accountId, installationId, plan, clientType, enabled, load, ownerWindow]);
  const refresh = useCallback(() => currentRefresh.current?.scope === scope ? currentRefresh.current.run(true) : Promise.resolve(), [scope]);
  return { result: stored?.scope === scope ? stored.result : undefined, refresh };
}
