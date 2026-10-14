/** One pending, expiring callback per plugin instance. No credentials enter browser URLs. */
export class HumanVerification {
  private pending?: { state: string; finish: (token?: string) => void } | undefined;
  constructor(private readonly open: (url: string) => void, private readonly origin: string) {}

  request(signal: AbortSignal): Promise<string> {
    this.pending?.finish();
    return new Promise((resolve, reject) => {
      const state = crypto.randomUUID();
      const finish = (token?: string) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (this.pending?.state === state) this.pending = undefined;
        if (token) resolve(token);
        else reject(new Error("Human verification was cancelled or expired. Please try again."));
      };
      const cancel = () => finish();
      const timer = setTimeout(cancel, 4 * 60_000);
      this.pending = {state, finish};
      signal.addEventListener("abort", cancel, {once:true});
      if (signal.aborted) { cancel(); return; }
      const url = new URL("/plugin-verification", this.origin);
      url.searchParams.set("state", state);
      try { this.open(url.toString()); } catch { cancel(); }
    });
  }

  receive(params: Record<string,string>): void {
    if (!this.pending || params.state !== this.pending.state) return;
    if (params.cancel === "1") { this.pending.finish(); return; }
    const token = params.token;
    if (typeof token !== "string" || !token || token.length > 2048 || /[\s\x00-\x1f]/.test(token)) return;
    this.pending.finish(token);
  }

  dispose(): void { this.pending?.finish(); }
}
