import {afterEach, describe, expect, it, vi} from "vitest";
import {HumanVerification} from "@/auth/HumanVerification";
const ticket = "A".repeat(43), pollToken = "B".repeat(43);
function setup() {
  const open = vi.fn();
  const api = {startRegistrationVerification: vi.fn(async () => ({pollToken, verificationUrl: `https://agentlens.example/plugin-verification?client=eagle#ticket=${ticket}`, expiresIn: 600, interval: 2})),
    pollRegistrationVerification: vi.fn(async () => ({status: "pending"}))};
  return {open, api, bridge: new HumanVerification(open, "https://agentlens.example", api)};
}
describe("HumanVerification", () => {
  afterEach(() => vi.useRealTimers());
  it("completes without a return click, protocol callback, or focus event", async () => {
    vi.useFakeTimers(); const {open, api, bridge} = setup();
    const pending = bridge.request(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledWith(`https://agentlens.example/plugin-verification?client=obsidian#ticket=${ticket}`);
    api.pollRegistrationVerification.mockResolvedValue({status: "verified"});
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(pollToken);
    expect(open.mock.calls[0]![0]).not.toContain(pollToken);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.pollRegistrationVerification).toHaveBeenCalledTimes(2);
  });
  it("cancels pending requests and ignores late verification", async () => {
    vi.useFakeTimers(); const {api, bridge} = setup();
    const controller = new AbortController(); const pending = bridge.request(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    const rejected = expect(pending).rejects.toThrow(/cancelled/); controller.abort(); await rejected;
    api.pollRegistrationVerification.mockResolvedValue({status: "verified"});
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.pollRegistrationVerification).toHaveBeenCalledTimes(1);
  });
  it("expires and stops polling", async () => {
    vi.useFakeTimers(); const {api, bridge} = setup();
    const rejected = expect(bridge.request(new AbortController().signal)).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(240000); await rejected;
    const calls = api.pollRegistrationVerification.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000); expect(api.pollRegistrationVerification).toHaveBeenCalledTimes(calls);
  });
  it.each(["cancelled", "consumed"])("rejects %s sessions", async status => {
    const {api, bridge} = setup(); api.pollRegistrationVerification.mockResolvedValue({status});
    await expect(bridge.request(new AbortController().signal)).rejects.toThrow(/cancelled/);
  });
  it("rejects foreign browser URLs before opening or polling", async () => {
    const {open, api, bridge} = setup();
    api.startRegistrationVerification.mockResolvedValue({pollToken, verificationUrl: `https://foreign.example/plugin-verification#ticket=${ticket}`, expiresIn: 600, interval: 2});
    await expect(bridge.request(new AbortController().signal)).rejects.toThrow(/Invalid/);
    expect(open).not.toHaveBeenCalled(); expect(api.pollRegistrationVerification).not.toHaveBeenCalled();
  });
  it("does not open a browser after cancellation during start", async () => {
    const {open, bridge} = setup(); const controller = new AbortController();
    const pending = bridge.request(controller.signal); controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/); expect(open).not.toHaveBeenCalled();
  });
});
