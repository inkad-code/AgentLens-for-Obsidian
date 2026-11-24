export interface RegistrationVerificationApi {
  startRegistrationVerification(): Promise<{pollToken: string; verificationUrl: string; expiresIn: number; interval: number}>;
  pollRegistrationVerification(pollToken: string): Promise<{status: string}>;
}

/** Polling is independent of focus and OS protocol handlers. Credentials stay in the plugin. */
export class HumanVerification {
  private cancelPending?: (() => void) | undefined;
  constructor(private readonly open: (url: string) => void, private readonly origin: string,
    private readonly api: RegistrationVerificationApi) {}

  request(signal: AbortSignal): Promise<string> {
    this.cancelPending?.();
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: number | undefined;
      const finish = (error?: Error, pollToken?: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearTimeout(pollTimer);
        signal.removeEventListener("abort", cancel);
        if (this.cancelPending === cancel) this.cancelPending = undefined;
        if (error) reject(error);
        else resolve(pollToken!);
      };
      const cancel = () => finish(new Error("Human verification was cancelled or expired. Please try again."));
      const timeout = window.setTimeout(cancel, 4 * 60_000);
      this.cancelPending = cancel;
      signal.addEventListener("abort", cancel, {once: true});
      if (signal.aborted) { cancel(); return; }
      const run = async () => {
        try {
          const session = await this.api.startRegistrationVerification();
          if (settled) return;
          const url = new URL(session.verificationUrl);
          if (url.origin !== this.origin || url.pathname !== "/plugin-verification" || url.username || url.password
              || !/^[A-Za-z0-9_-]{43}$/.test(new URLSearchParams(url.hash.slice(1)).get("ticket") || "")
              || !/^[A-Za-z0-9_-]{43}$/.test(session.pollToken)) throw new Error("Invalid verification session.");
          url.searchParams.set("client", "obsidian");
          this.open(url.toString());
          const poll = async () => {
            try {
              const result = await this.api.pollRegistrationVerification(session.pollToken);
              if (settled) return;
              if (result.status === "verified") { finish(undefined, session.pollToken); return; }
              if (result.status !== "pending") { cancel(); return; }
              pollTimer = window.setTimeout(() => { void poll(); }, Math.max(2, session.interval) * 1000);
            } catch (error) { finish(error instanceof Error ? error : new Error("Verification could not finish. Please try again.")); }
          };
          if (!settled) await poll();
        } catch (error) { finish(error instanceof Error ? error : new Error("Verification could not start. Please try again.")); }
      };
      void run();
    });
  }

  dispose(): void { this.cancelPending?.(); }
}
