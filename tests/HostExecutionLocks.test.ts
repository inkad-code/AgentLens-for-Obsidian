import { expect, it } from "vitest";
import { HostExecutionLocks } from "@/runtime/HostExecutionLocks";

it("serializes separate window coordinators in arrival order and releases a failed holder", async () => {
  const first = new HostExecutionLocks(), second = new HostExecutionLocks();
  const order: number[] = [];
  let release!: () => void;
  const running = first.run(["vault", "one"], async () => { order.push(1); await new Promise<void>(resolve => { release = resolve; }); throw new Error("write failed"); });
  const failed = expect(running).rejects.toThrow("write failed");
  await Promise.resolve();
  const queued = second.run(["vault", "one"], async () => { order.push(2); });
  expect(await second.tryRun(["vault", "one"], async () => "wrong", () => "busy")).toBe("busy");
  expect(await second.run(["vault", "other"], async () => "independent")).toBe("independent");
  expect(order).toEqual([1]); release(); await failed; await queued;
  expect(order).toEqual([1, 2]);
});

it("does not silently use an unsafe per-window lock when the host API is unavailable", () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  expect(() => new HostExecutionLocks().run(["write"], async () => undefined)).toThrow("Update Obsidian");
});
