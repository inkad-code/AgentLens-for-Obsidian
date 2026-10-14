import { usePlatformDirectory } from "../../runtime/usePlatformDirectory";
import { useHostWindow } from "./HostDocument";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthState, DeviceAuthorizationIntent } from "../../auth/AuthService";
import type { AccountSummary } from "../../api/AgentLensApiClient";
import type { AccountCapabilities, PublicPlatformCatalog } from "../../api/contracts";
import type { AgentLensWorkbenchPort } from "../../workbench/ports";
import { message } from "./shared";

export function systemBrowserOpener(): ((url: string) => Promise<void>) | null {
  try {
    const loader = (window as { require?: (id: string) => unknown }).require
      ?? (typeof require === "function" ? require : null);
    const electron = loader?.("electron") as { shell?: { openExternal?: (url: string) => Promise<void> } } | undefined;
    const shell = electron?.shell;
    if (shell?.openExternal) return (url) => shell.openExternal!(url);
  } catch { /* Browser preview and mobile hosts do not provide Electron. */ }
  return null;
}

export function useWorkbenchSession(service?: AgentLensWorkbenchPort) {
  const window = useHostWindow();
  const [authState, setAuthState] = useState<Readonly<AuthState>>(service?.authState() ?? { status: "signed_out" });
  const [authRestoring, setAuthRestoring] = useState(Boolean(service));
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionScope = useMemo(() => ({}), [service, authState.status]);
  const [accountSnapshot, setAccountSnapshot] = useState<{scope: object; value: AccountSummary} | null>(null);
  const account = accountSnapshot?.scope === sessionScope ? accountSnapshot.value : null;
  const [accountUpdatedAt, setAccountUpdatedAt] = useState<number | null>(null);
  const [accountStale, setAccountStale] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const accountRefresh = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const signedIn = authState.status === "signed_in";
  const loadDirectory = useCallback((): Promise<AccountCapabilities | PublicPlatformCatalog> => {
    if (!service) return Promise.reject(new Error("Platform directory unavailable"));
    if (signedIn) return service.capabilities();
    return service.publicPlatformCatalog?.() ?? Promise.reject(new Error("Platform directory unavailable"));
  }, [service, signedIn]);
  const directory = usePlatformDirectory({
    accountId: signedIn ? account?.user.id : undefined,
    installationId: signedIn ? account?.installationId : undefined,
    plan: signedIn ? account?.subscription.plan : undefined,
    clientType: "obsidian_plugin", load: loadDirectory, ownerWindow: window,
    enabled: Boolean(service) && !authRestoring && (!signedIn || Boolean(account))
  });
  const data = directory.result?.data;
  const capabilities = signedIn && data && "accountId" in data ? data : null;
  const publicCatalog = !signedIn && data && "clientType" in data ? data : null;
  const capabilitiesError = signedIn && Boolean(directory.result?.failed);
  const publicCatalogError = !signedIn && Boolean(directory.result?.failed);


  useEffect(() => {
    if (!service) {
      setAuthRestoring(false);
      return undefined;
    }
    let active = true;
    setAuthRestoring(true);
    const unsubscribe = service.subscribeAuth(setAuthState);
    void service.restoreAuth()
      .catch((error) => { if (active) setAuthError(message(error, "auth")); })
      .finally(() => { if (active) setAuthRestoring(false); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service]);

  useEffect(() => {
    setAccountSnapshot(null);
    setAccountUpdatedAt(null);
    setAccountStale(false);
    setAccountBusy(false);
    accountRefresh.current = null;
    if (!service || authRestoring || authState.status !== "signed_in") return;
    let active = true;
    let pending: Promise<void> | null = null;
    let nextRefreshAt = 0;
    let retryDelayMs = 60_000;
    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (!active || window.document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        if (window.document.visibilityState !== "hidden") void refresh();
      }, Math.max(0, nextRefreshAt - Date.now()));
    };
    const refresh = (force = false): Promise<void> => {
      if (!active) return Promise.resolve();
      if (pending) return pending;
      if (!force && Date.now() < nextRefreshAt) { schedule(); return Promise.resolve(); }
      clearTimer();
      // Defer service calls until the shared in-flight promise is assigned.
      pending = Promise.resolve().then(async () => {
        try {
          if (!active) return;
          const nextAccount = await service.account();
          if (!active) return;
          setAccountSnapshot({scope: sessionScope, value: nextAccount});
          setAccountUpdatedAt(Date.now());
          setAccountStale(false);
          setAuthError(null);
          retryDelayMs = 60_000;
          nextRefreshAt = Date.now() + 5 * 60_000;
        } catch (error) {
          if (!active) return;
          setAccountStale(true);
          setAuthError(message(error, "read_only"));
          nextRefreshAt = Date.now() + retryDelayMs;
          retryDelayMs = Math.min(retryDelayMs * 2, 15 * 60_000);
        } finally {
          pending = null;
          schedule();
        }
      });
      return pending;
    };
    accountRefresh.current = refresh;
    const visible = () => {
      if (window.document.visibilityState === "hidden") clearTimer();
      else void refresh();
    };
    void refresh(true);
    window.addEventListener("focus", visible);
    window.document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimer();
      if (accountRefresh.current === refresh) accountRefresh.current = null;
      window.removeEventListener("focus", visible);
      window.document.removeEventListener("visibilitychange", visible);
    };
  // Access-token refresh stays in the same signed-in session. Do not clear the
  // platform catalog and account on each token rotation. Sign-out/service changes
  // still tear down this effect and clear the previous session.
  }, [service, authRestoring, authState.status, window, sessionScope]);

  useEffect(() => {
    if (!service || authState.status !== "authorizing") return undefined;
    const delay = Math.max(0, authState.nextPollAt - Date.now());
    const timer = window.setTimeout(() => {
      void service.pollSignIn().then(() => setAuthError(null)).catch((error) => setAuthError(message(error, "auth")));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [service, authState]);

  const withAuthBusy = async (action: () => Promise<unknown>, reportError = true) => {
    setAuthBusy(true);
    if (reportError) setAuthError(null);
    try {
      await action();
    } catch (error) {
      if (reportError) setAuthError(message(error, "auth"));
      else throw error;
    } finally {
      setAuthBusy(false);
    }
  };

  const beginSignIn = (provider: "google", intent: DeviceAuthorizationIntent = "sign_in") => {
    if (!service) return Promise.resolve();
    const openInSystemBrowser = systemBrowserOpener();
    // The browser fallback needs the original click gesture. Electron's shell
    // can open the final authorization URL after the device request completes.
    let signInWindow: Window | null = null;
    if (provider === "google" && !openInSystemBrowser) {
      try {
        signInWindow = window.open("about:blank", "_blank");
        if (signInWindow) signInWindow.opener = null;
      } catch { /* The sign-in page retains a way to reopen the browser. */ }
    }
    return withAuthBusy(async () => {
      try {
        const state = await service.startSignIn(provider, intent);
        if (provider === "google" && state.status === "authorizing") {
          const url = state.authorization.verificationUriComplete ?? state.authorization.verificationUri;
          if (openInSystemBrowser) await openInSystemBrowser(url);
          else if (signInWindow && !signInWindow.closed) signInWindow.location.replace(url);
          else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Could not open the sign-in page. Use the Google button to try again.");
        } else signInWindow?.close();
      } catch (error) {
        signInWindow?.close();
        throw error;
      }
    });
  };
  const openAuthorizationPage = (url: string) => {
    const openInSystemBrowser = systemBrowserOpener();
    if (openInSystemBrowser) return openInSystemBrowser(url).catch(error => setAuthError(message(error, "auth")));
    if (!window.open(url, "_blank", "noopener,noreferrer")) setAuthError("Could not open the sign-in page in your browser.");
    return Promise.resolve();
  };
  const emailSignIn = (credentials: import("../../auth/AuthService").EmailCredentials) => withAuthBusy(async()=>{
    if(!service?.signInWithEmail)throw new Error("Email sign-in is unavailable. Use browser authorization.");
    await service.signInWithEmail(credentials);
  },false);
  const retryRestore = () => service ? withAuthBusy(() => service.restoreAuth()) : Promise.resolve();
  const cancelSignIn = () => service ? withAuthBusy(() => service.signOut(), false).catch(() => undefined) : Promise.resolve();
  const signOut = () => service ? withAuthBusy(() => service.signOut()) : Promise.resolve();

  async function refreshAccount(): Promise<void> {
    const refresh = accountRefresh.current;
    if (!refresh) return;
    setAccountBusy(true);
    setAuthError(null);
    try {
      // Explicit refresh and post-save balance updates bypass TTL/backoff, not in-flight deduplication.
      await Promise.all([refresh(true), directory.refresh()]);
    } finally {
      if (accountRefresh.current === refresh) setAccountBusy(false);
    }
  }

  return {
    authState, authRestoring, authBusy, authError, capabilities, capabilitiesError, publicCatalog, publicCatalogError, account, accountUpdatedAt,
    accountStale, accountBusy, beginSignIn, emailSignIn, retryRestore,
    cancelSignIn, signOut, refreshAccount, openAuthorizationPage
  };
}
