import { describe, expect, it } from "vitest";
import { userMessage } from "@/core/user-feedback";
import { ConnectivityGate } from "@/runtime/ConnectivityGate";

describe("ConnectivityGate", () => {
  it("blocks offline work before a network request can start", () => {
    const gate = new ConnectivityGate(() => false);

    expect(gate.isOnline()).toBe(false);
    let failure: unknown;
    try { gate.requireOnline(); } catch (error) { failure = error; }
    expect(userMessage(failure)).toBe("You’re offline. Check your connection and try again. This action hasn’t started.");
    expect(() => gate.requireOnline()).toThrow("No network request was started");
  });

  it("allows work only while the injected host signal is online", () => {
    let online = true;
    const gate = new ConnectivityGate(() => online);

    expect(() => gate.requireOnline()).not.toThrow();
    online = false;
    expect(() => gate.requireOnline()).toThrow(/offline/i);
  });
});
