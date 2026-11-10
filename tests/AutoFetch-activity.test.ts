import { expect, it } from "vitest";
import { AutoFetchActivityTracker, type AutoFetchActivityScope } from "@/workbench/AutoFetchActivity";
const scope: AutoFetchActivityScope = { userId: "owner", installationId: "vault", creatorId: "creator", epoch: 1, folderPath: "Research" };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it("isolates live facts by account, installation, creator, session and original folder", async () => {
  const tracker = new AutoFetchActivityTracker(), old = gate(), current = gate();
  const first = tracker.track(scope, "parsing", () => old.promise);
  expect(tracker.get(scope)).toMatchObject({ parsing: true, importing: false });
  for (const patch of [{ userId: "other" }, { installationId: "other" }, { creatorId: "other" }, { epoch: 2 }, { folderPath: "Other" }])
    expect(tracker.get({ ...scope, ...patch })).toEqual({ parsing: false, importing: false });
  expect(tracker.get("creator")).toEqual({ parsing: false, importing: false });
  const next = { ...scope, epoch: 2 };
  const second = tracker.track(next, "importing", () => current.promise);
  old.resolve(); await first;
  expect(tracker.get(scope)).toEqual({ parsing: false, importing: false });
  expect(tracker.get(next)).toEqual({ parsing: false, importing: true });
  current.resolve(); await second;
  expect(tracker.get(next)).toEqual({ parsing: false, importing: false });
});
it("retains concurrent active counts and releases them when work fails even if an observer throws", async () => {
  const tracker = new AutoFetchActivityTracker(), first = gate(), second = gate();
  tracker.subscribe(() => { throw new Error("unmounted observer"); });
  const a = tracker.track(scope, "importing", () => first.promise);
  const b = tracker.track(scope, "importing", async () => { await second.promise; throw new Error("write failed"); });
  first.resolve(); await a;
  expect(tracker.get(scope).importing).toBe(true);
  const rejected = expect(b).rejects.toThrow("write failed");
  second.resolve(); await rejected;
  expect(tracker.get(scope).importing).toBe(false);
});
