import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { OperationStore } from "@/auto-fetch/operation-store";
import { registerDevelopmentCreator, registerNewCreator } from "@/auto-fetch/register-creator";
import type { CreatorRecord } from "@/api/AgentLensApiClient";
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00.000Z";
const creator = { creatorId: "creator", followId: "follow", configRevision: 1,
  activationAt: at, lastCheckedAt: null, activeJobId: null } as CreatorRecord;

describe("new follow activation boundary", () => {
  it("initializes development bindings once without resetting gaps on restart", async () => {
    const store = new OperationStore("development-cutover");
    const old = { ...creator, lastCheckedAt: at, activeJobId: "existing-run", autoFetchEnabled: false };
    const cutover = "2026-10-20T00:00:00Z";
    const outcomes = await Promise.all([
      registerDevelopmentCreator(store, scope, old, cutover),
      registerDevelopmentCreator(store, scope, old, cutover)
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(await registerDevelopmentCreator(new OperationStore("development-cutover"), scope,
      old, "2026-10-21T00:00:00Z")).toBe(false);
    expect(await store.watermark(scope)).toMatchObject({ observedThrough: cutover, version: 0 });
    expect(old.activeJobId).toBe("existing-run");
  });

  it("never starts before activation or registers an unrelated binding", async () => {
    const store = new OperationStore("development-activation");
    expect(await registerDevelopmentCreator(store, { ...scope, creatorId: "other" }, creator, at)).toBe(false);
    expect(await registerDevelopmentCreator(store, scope, creator, "2026-10-18T00:00:00Z")).toBe(true);
    expect((await store.watermark(scope))?.observedThrough).toBe(at);
  });
  it("registers exactly the server activation and cannot replace an existing waterline", async () => {
    const store = new OperationStore("new-follow");
    expect(await registerNewCreator(store, scope, creator, at)).toBe(true);
    expect(await store.watermark(scope)).toMatchObject({ observedThrough: at, lastSequence: 0, version: 0 });
    expect(await registerNewCreator(new OperationStore("new-follow"), scope,
      { ...creator, activationAt: "2026-10-20T00:00:00Z" }, at)).toBe(false);
    expect((await store.watermark(scope))?.observedThrough).toBe(at);
  });
  it.each([
    { activationAt: "2026-10-18T00:00:00Z" }, { activationAt: undefined },
    { followId: undefined }, { configRevision: undefined }, { activeJobId: "legacy-job" },
    { lastCheckedAt: at }
  ])("does not reset old or unproven follows (%j)", async patch => {
    const store = new OperationStore(`legacy-${JSON.stringify(patch)}`);
    expect(await registerNewCreator(store, scope, { ...creator, ...patch }, at)).toBe(false);
    expect(await store.watermark(scope)).toBeUndefined();
  });
});
