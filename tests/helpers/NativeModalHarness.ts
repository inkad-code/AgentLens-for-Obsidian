function element(tag = "div"): any {
  const el = document.createElement(tag);
  return Object.assign(el, {
    empty: () => el.replaceChildren(), setText: (text: string) => {el.textContent = text;},
    createEl: (name: string, options: any = {}) => {
      const child = element(name); if (options.text) child.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, String(value));
      el.append(child); return child;
    }
  });
}
export class Modal {
  modalEl = element(); titleEl = element("h2"); contentEl = element();
  constructor(_app: unknown) { this.modalEl.setAttribute("role", "dialog"); this.modalEl.append(this.titleEl, this.contentEl); }
  onOpen(): void {} onClose(): void {}
  open(): void { document.body.append(this.modalEl); this.onOpen(); }
  close(): void {this.onClose(); this.modalEl.remove();}
}
export class Setting {
  private row = element(); private label = element("label");
  constructor(parent: HTMLElement) {parent.append(this.row); this.row.append(this.label);}
  setName(name: string): this {this.label.textContent = name; return this;}
  setDesc(text: string): this {this.row.createEl("p", {text}); return this;}
  private component(tag: string, type?: string) {
    const el = element(tag); if (type) el.type = type;
    const id = crypto.randomUUID(); el.id = id; if (tag != "button") this.label.htmlFor = id; this.row.append(el);
    const c: any = {
      buttonEl: el,
      setButtonText: (text: string) => {el.textContent = text; return c;},
      setDisabled: (value: boolean) => {el.disabled = value; return c;}, setCta: () => c, setWarning: () => c,
      setValue: (value: string | boolean) => {if (typeof value === "boolean") el.checked = value; else el.value = value; return c;},
      onClick: (fn: () => void) => {el.addEventListener("click", fn); return c;},
      onChange: (fn: (value: any) => void) => {el.addEventListener("change", () => fn(type === "checkbox" ? el.checked : el.value)); return c;},
      addOption: (value: string, text: string) => {const o = document.createElement("option"); o.value = value; o.textContent = text; el.append(o); return c;}
    }; return c;
  }
  addButton(fn: (c: any) => void): this {fn(this.component("button")); return this;}
  addDropdown(fn: (c: any) => void): this {fn(this.component("select")); return this;}
  addToggle(fn: (c: any) => void): this {fn(this.component("input", "checkbox")); return this;}
}
