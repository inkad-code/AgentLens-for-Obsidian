import { describe, expect, it, vi } from "vitest";
import { AutoFetchActivityTracker } from "@/workbench/AutoFetchActivity";

describe("background balance notifications", () => {
  it("notifies after source success or failure, never for downloading, and isolates observer failures", async () => {
    const tracker = new AutoFetchActivityTracker();
    const settled = vi.fn(() => { expect(tracker.get("creator").parsing).toBe(false); });
    const unsubscribe = tracker.subscribeSourceSettled(settled);
    tracker.subscribeSourceSettled(() => { throw new Error("observer failed"); });
    await expect(tracker.track("creator", "parsing", async () => 42)).resolves.toBe(42);
    const error = new Error("provider failed");
    await expect(tracker.track("creator", "parsing", async () => { throw error; })).rejects.toBe(error);
    await tracker.track("creator", "importing", async () => 1);
    expect(settled).toHaveBeenCalledTimes(2);
    unsubscribe();
    await tracker.track("creator", "parsing", async () => 1);
    expect(settled).toHaveBeenCalledTimes(2);
  });
});
