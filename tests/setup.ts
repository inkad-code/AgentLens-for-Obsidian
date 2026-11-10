import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Node HTTP integration tests still execute renderer-owned code. Supply only the
// host timers/navigator; retain real Node networking and filesystem behavior.
if (typeof window === "undefined") {
  vi.stubGlobal("window", { setTimeout, clearTimeout, navigator });
}
afterEach(() => cleanup());

// jsdom has no Web Locks implementation. Production requires the actual host API.
import { TestLockManager } from "./helpers/TestLockManager";
beforeEach(() => Object.defineProperty(navigator, "locks", { configurable: true, value: new TestLockManager() }));
if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(this: HTMLElement, tag: K): HTMLElementTagNameMap[K] {
    const child = this.ownerDocument.createElement(tag);
    this.appendChild(child);
    return child;
  } as typeof HTMLElement.prototype.createEl;
  HTMLElement.prototype.createDiv = function() { return this.createEl("div"); };
}
