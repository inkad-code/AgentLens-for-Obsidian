import { describe, expect, it } from "vitest";
import type { CreatorRecord } from "@/api/AgentLensApiClient";
import { creatorStatus } from "@/ui/workbench/creatorStatusProjection";
import { AutoFetchActivityTracker } from "@/workbench/AutoFetchActivity";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";

const creator = (patch: Partial<CreatorRecord> = {}) => ({ autoFetchEnabled: true, schedulerState: "scheduled", activeJobId: null, ...patch } as CreatorRecord);
describe("Eagle Auto-Fetch behavioral parity", () => {
  it("uses five main states and does not present a persisted job as live work", () => {
    expect(creatorStatus(creator({ activeJobId: "old", schedulerState: "catch_up_running" }))).toMatchObject({ mainStatus: "scheduled", subStatus: "check_queued" });
    expect(creatorStatus(creator({ schedulerState: "error" }), { parsing: true }).label).toBe("Fetching Now");
    expect(creatorStatus(creator(), { importing: true }).label).toBe("Importing Now");
    expect(creatorStatus(creator({ autoFetchEnabled: false }), { parsing: true, importing: true }).label).toBe("Paused");
    expect(creatorStatus(creator({ schedulerState: "error" })).label).toBe("Failed");
    expect(creatorStatus(creator({ schedulerState: "requires_reconciliation" }))).toMatchObject({ mainStatus: "scheduled", subStatus: "verifying_source" });
    expect(creatorStatus(creator({ schedulerState: "scheduled", lastError: "Old error" })).label).toBe("Scheduled");
  });
  it("counts concurrent live operations independently and clears evidence on failure", async () => {
    const activity = new AutoFetchActivityTracker();
    let finish!: () => void;
    const pending = activity.track("creator", "parsing", () => new Promise<void>(resolve => { finish = resolve; }));
    await expect(activity.track("creator", "parsing", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    expect(activity.get("creator").parsing).toBe(true);
    finish(); await pending;
    expect(activity.get("creator").parsing).toBe(false);
  });
  it("serializes writes in arrival order and continues after a failed write", async () => {
    const requests = new RequestCoordinator();
    const order: number[] = [];
    let finish!: () => void;
    const first = requests.enqueue("write", async () => { order.push(1); await new Promise<void>(resolve => { finish = resolve; }); throw new Error("failed"); });
    const failure = expect(first).rejects.toThrow("failed");
    const second = requests.enqueue("write", async () => { order.push(2); });
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual([1]);
    finish(); await failure; await second;
    expect(order).toEqual([1, 2]);
  });
});
