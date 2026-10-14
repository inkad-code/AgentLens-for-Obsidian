export class ConnectivityGate {
  constructor(private readonly online: () => boolean = () => navigator.onLine) {}

  isOnline(): boolean {
    return this.online();
  }

  requireOnline(): void {
    if (!this.online()) throw new Error("AgentLens is offline. No network request was started.");
  }
}

