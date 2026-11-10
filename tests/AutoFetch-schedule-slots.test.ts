import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ScheduleRevision } from "@/api/scheduleHistory";
import { nextFixedSlot, slotTime, uncoveredSlots } from "@/auto-fetch/schedule-slots";

const config: ScheduleRevision = { revision: 1, effectiveAt: "2026-09-16T08:00:00Z", anchorAt: "2026-09-16T08:00:00Z",
  frequencyEvery: 1, frequencyUnit: "hour", autoFetchEnabled: true, deleted: false, legacySnapshot: false };
describe("fixed UTC slots and compact recovery coverage", () => {
  it("uses the original anchor and a strictly future slot regardless of execution duration", () => {
    expect(nextFixedSlot(config, "2026-09-16T10:20:00Z")).toEqual({ slot: 3, at: "2026-09-16T11:00:00.000Z" });
    expect(nextFixedSlot(config, "2026-09-16T11:00:00Z")).toEqual({ slot: 4, at: "2026-09-16T12:00:00.000Z" });
    expect(nextFixedSlot({ ...config, frequencyEvery: 2 }, "2026-09-16T11:00:00Z").at).toBe("2026-09-16T12:00:00.000Z");
  });
  it("preserves the server anchor's microseconds", () => {
    const precise = { ...config, anchorAt: "2026-09-16T08:00:00.123456Z" };
    expect(slotTime(precise, 2)).toBe("2026-09-16T10:00:00.123456Z");
    expect(nextFixedSlot(precise, "2026-09-16T10:00:00.123455Z").slot).toBe(2);
    expect(nextFixedSlot(precise, "2026-09-16T10:00:00.123456Z").slot).toBe(3);
  });
  it("subtracts persisted tasks before catching up and retains separate gaps", () => {
    expect(uncoveredSlots([config], config.effectiveAt, "2026-09-16T14:00:00Z", [
      { revision: 1, firstSlot: 2, lastSlot: 3 }, { revision: 1, firstSlot: 5, lastSlot: 5 }
    ])).toEqual([
      { revision: 1, firstSlot: 1, lastSlot: 1 }, { revision: 1, firstSlot: 4, lastSlot: 4 }, { revision: 1, firstSlot: 6, lastSlot: 6 }
    ]);
  });
  it("excludes paused slots and uses the accepted frequency at each boundary", () => {
    const history = [config,
      { ...config, revision: 2, effectiveAt: "2026-09-16T10:00:00Z", autoFetchEnabled: false },
      { ...config, revision: 3, effectiveAt: "2026-09-16T13:00:00Z", frequencyEvery: 2 }];
    expect(uncoveredSlots(history, config.effectiveAt, "2026-09-16T16:00:00Z", [])).toEqual([
      { revision: 1, firstSlot: 1, lastSlot: 1 }, { revision: 3, firstSlot: 3, lastSlot: 4 }
    ]);
  });
  it("represents long offline intervals with one range instead of millions of tasks", () => {
    const minute = { ...config, frequencyUnit: "minute" as const };
    const result = uncoveredSlots([minute], config.effectiveAt, "2036-09-16T08:00:00Z", []);
    expect(result).toHaveLength(1);
    expect(result[0]!.lastSlot).toBeGreaterThan(5_000_000);
  });
  it("does not invent work when no slot was missed or all slots already have a task", () => {
    expect(uncoveredSlots([config], config.effectiveAt, "2026-09-16T08:59:59Z", [])).toEqual([]);
    expect(uncoveredSlots([config], config.effectiveAt, "2026-09-16T11:00:00Z", [
      { revision: 1, firstSlot: 1, lastSlot: 3 }
    ])).toEqual([]);
  });
  it("does not interpret a legacy migration boundary as a new-device activation", () => {
    expect(() => uncoveredSlots([{ ...config, legacySnapshot: true }], "2026-09-15T08:00:00Z", "2026-09-16T11:00:00Z", []))
      .toThrow("does not cover");
  });
  it("refuses revision holes, anchor changes and reversed times", () => {
    expect(() => uncoveredSlots([config, { ...config, revision: 3 }], config.effectiveAt, "2026-09-16T11:00:00Z", [])).toThrow("contiguous");
    expect(() => uncoveredSlots([config, { ...config, revision: 2, anchorAt: "2026-09-16T09:00:00Z" }], config.effectiveAt, "2026-09-16T11:00:00Z", [])).toThrow("anchor");
    expect(() => uncoveredSlots([config], "2026-09-16T12:00:00Z", "2026-09-16T11:00:00Z", [])).toThrow("reversed");
  });
});
