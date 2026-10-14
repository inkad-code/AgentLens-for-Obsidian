import {afterEach, describe, expect, it, vi} from "vitest";
import {HumanVerification} from "@/auth/HumanVerification";

describe("HumanVerification", () => {
  afterEach(() => vi.useRealTimers());
  it("accepts only the pending nonce and rejects replay", async () => {
    const open=vi.fn(); const bridge=new HumanVerification(open,"https://agentlens.example");
    const pending=bridge.request(new AbortController().signal);
    const url=new URL(open.mock.calls[0]![0]);
    expect(url.pathname).toBe("/plugin-verification");
    expect([...url.searchParams.keys()]).toEqual(["state"]);
    bridge.receive({state:"wrong",token:"invalid"});
    const state=url.searchParams.get("state")!;
    bridge.receive({state,token:"verified-token"});
    expect(await pending).toBe("verified-token");
    const next=bridge.request(new AbortController().signal);
    bridge.receive({state,token:"replay"});
    const rejected=expect(next).rejects.toThrow(/cancelled/);
    bridge.dispose(); await rejected;
  });
  it("cancels immediately and expires without returning stale tokens", async () => {
    vi.useFakeTimers();
    const bridge=new HumanVerification(vi.fn(),"https://agentlens.example");
    const controller=new AbortController();const pending=bridge.request(controller.signal);
    const cancelled=expect(pending).rejects.toThrow(/cancelled/);controller.abort();await cancelled;
    const expired=expect(bridge.request(new AbortController().signal)).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(240_000);await expired;
  });
});
