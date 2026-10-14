export const apiVersion = "1.13.7";

export const Platform = {
  isMobile: false,
  isIosApp: false,
  isAndroidApp: false,
  isWin: false,
  isLinux: false
};

export function addIcon(): void {}

export class TFile {
  constructor(public path = "") {}
}

export class MarkdownView {
  editor: unknown;
}

export class Notice {
  static readonly messages: string[] = [];

  constructor(public readonly message: string) {
    Notice.messages.push(message);
  }
}

export class Plugin {
  registerView() {}
  registerObsidianProtocolHandler() {}
  register() {}
  app: any;
  manifest: any;
  readonly __commands: any[] = [];
  readonly __ribbons: any[] = [];
  readonly __settingTabs: any[] = [];
  readonly __intervals: number[] = [];
  private __data: unknown = {};

  constructor(app: any = {}, manifest: any = { id: "agentlens-social-importer", version: "0.1.0" }) {
    this.app = app;
    this.manifest = manifest;
  }

  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement {
    this.__ribbons.push({ icon, title, callback });
    return document.createElement("div");
  }

  addCommand(command: any): void { this.__commands.push(command); }
  addSettingTab(tab: any): void { this.__settingTabs.push(tab); }
  registerInterval(id: number): number { this.__intervals.push(id); return id; }
  async loadData(): Promise<unknown> { return structuredClone(this.__data); }
  async saveData(data: unknown): Promise<void> { this.__data = structuredClone(data); }
  __setData(data: unknown): void { this.__data = structuredClone(data); }
  __getData(): unknown { return structuredClone(this.__data); }
}

export class Scope {
  constructor(public parent?: Scope) {}
  register(): void {}
}

export class Modal {
  scope = new Scope();
  readonly modalEl = mockElement();
  readonly contentEl = mockElement();

  constructor(public readonly app: any) {}
  onOpen?(): void;
  onClose?(): void;
  open(): void { this.onOpen?.(); }
  close(): void { this.onClose?.(); }
}

export class PluginSettingTab {
  readonly containerEl = mockElement();

  constructor(public readonly app: any, public readonly plugin: any) {}
}

export class Setting {
  constructor(public readonly containerEl: any) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  addText(callback: (component: ChainableComponent) => unknown): this { callback(new ChainableComponent()); return this; }
  addDropdown(callback: (component: ChainableComponent) => unknown): this { callback(new ChainableComponent()); return this; }
  addToggle(callback: (component: ChainableComponent) => unknown): this { callback(new ChainableComponent()); return this; }
  addButton(callback: (component: ChainableComponent) => unknown): this { callback(new ChainableComponent()); return this; }
}

class ChainableComponent {
  setPlaceholder(): this { return this; }
  setValue(): this { return this; }
  onChange(): this { return this; }
  onClick(): this { return this; }
  addOption(): this { return this; }
  setButtonText(): this { return this; }
}

function mockElement(): any {
  return {
    addClass() {},
    empty() {},
    createEl() { return mockElement(); }
  };
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export async function requestUrl(): Promise<never> {
  throw new Error("Tests must inject a requestUrl transport.");
}

export class ItemView {
  readonly contentEl = Object.assign(document.createElement("div"), {
    addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
    empty(this: HTMLElement) { this.replaceChildren(); }
  });
  readonly app: any;
  constructor(public readonly leaf: any) { this.app = leaf.app; }
  async close(): Promise<void> { await (this as unknown as { onClose?: () => Promise<void> }).onClose?.(); }
}

export class TFolder { constructor(public path = "") {} }
