import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(this: HTMLElement, tag: K): HTMLElementTagNameMap[K] {
    const child = this.ownerDocument.createElement(tag);
    this.appendChild(child);
    return child;
  } as typeof HTMLElement.prototype.createEl;
  HTMLElement.prototype.createDiv = function() { return this.createEl("div"); };
}
