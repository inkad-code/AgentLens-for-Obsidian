export type HostTickReason = "service_start" | "periodic_tick" | "network_restored" | "host_activated";

export interface HostLifecycleHandlers {
  onTick(reason: HostTickReason): Promise<void> | void;
}

export class HostLifecycleCoordinator {
  private started = false;
  private onlineListener: (() => void) | undefined;
  private focusListener: (() => void) | undefined;
  private visibilityListener: (() => void) | undefined;
  private intervalId: number | undefined;

  constructor(
    private readonly handlers: HostLifecycleHandlers,
    private readonly isActive: () => boolean = () => document.visibilityState === "visible"
  ) {}

  start(registerInterval: (id: number) => number, intervalMs = 60_000): void {
    if (this.started) return;
    this.started = true;
    this.tickIfActive("service_start");
    this.intervalId = window.setInterval(() => {
      this.tickIfActive("periodic_tick");
    }, intervalMs);
    registerInterval(this.intervalId);
    this.onlineListener = () => {
      this.tickIfActive("network_restored");
    };
    window.addEventListener("online", this.onlineListener);
    this.focusListener = () => this.tickIfActive("host_activated");
    this.visibilityListener = () => this.tickIfActive("host_activated");
    window.addEventListener("focus", this.focusListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
  }

  stop(): void {
    if (this.intervalId !== undefined) window.clearInterval(this.intervalId);
    if (this.onlineListener) window.removeEventListener("online", this.onlineListener);
    if (this.focusListener) window.removeEventListener("focus", this.focusListener);
    if (this.visibilityListener) document.removeEventListener("visibilitychange", this.visibilityListener);
    this.onlineListener = undefined;
    this.focusListener = undefined;
    this.visibilityListener = undefined;
    this.intervalId = undefined;
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  private tickIfActive(reason: HostTickReason): void {
    if (!this.isActive()) return;
    void this.handlers.onTick(reason);
  }
}
