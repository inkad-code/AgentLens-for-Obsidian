import { afterEach, describe, expect, it, vi } from "vitest";
import { HostLifecycleCoordinator } from "@/runtime/HostLifecycleCoordinator";

describe("HostLifecycleCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the default background scheduler alive while the document is hidden", () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const onTick = vi.fn();
    const coordinator = new HostLifecycleCoordinator({ onTick });
    try {
      coordinator.start(id => id, 1_000);
      vi.advanceTimersByTime(1_000);
      expect(onTick).toHaveBeenCalledWith("periodic_tick");
    } finally { coordinator.stop(); hidden.mockRestore(); }
  });

  it("treats a delayed timer after sleep as recovery even without an online event", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const coordinator = new HostLifecycleCoordinator({ onTick });
    coordinator.start(id => id, 1_000);
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenLastCalledWith("host_activated");
    coordinator.stop();
  });

  it("starts once and uses only non-UI tick reasons", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const coordinator = new HostLifecycleCoordinator({ onTick }, () => true);
    const registerInterval = vi.fn((id: number) => id);

    coordinator.start(registerInterval, 1_000);
    coordinator.start(registerInterval, 1_000);

    expect(onTick).toHaveBeenCalledWith("service_start");
    expect(registerInterval).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenCalledWith("periodic_tick");
    expect(onTick).not.toHaveBeenCalledWith("view_open");
  });

  it("removes every activation listener and clears its interval on stop", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const coordinator = new HostLifecycleCoordinator({ onTick }, () => true);

    coordinator.start((id) => id, 60_000);
    window.dispatchEvent(new Event("online"));
    expect(onTick).toHaveBeenCalledWith("network_restored");

    coordinator.stop();
    onTick.mockClear();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(120_000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("does not reconcile while the host is hidden and resumes when activated", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    let active = false;
    const coordinator = new HostLifecycleCoordinator({ onTick }, () => active);

    coordinator.start((id) => id, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(onTick).not.toHaveBeenCalled();

    active = true;
    window.dispatchEvent(new Event("focus"));
    expect(onTick).toHaveBeenCalledWith("host_activated");
    coordinator.stop();
  });
});
