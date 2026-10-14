import { describe, expect, it, vi } from "vitest";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";

describe("RequestCoordinator", () => {
  it("shares one in-flight request for the same idempotency scope", async () => {
    const coordinator = new RequestCoordinator();
    let resolve!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>((done) => { resolve = done; }));

    const first = coordinator.runExclusive("single:youtube:42", operation);
    const second = coordinator.runExclusive("single:youtube:42", operation);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(coordinator.has("single:youtube:42")).toBe(true);

    resolve("ok");
    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
    expect(coordinator.has("single:youtube:42")).toBe(false);
  });
});

