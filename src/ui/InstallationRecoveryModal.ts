import { App, Modal, Setting } from "obsidian";
import { LegacyInstallationRecoveryRequired } from "../runtime/DeviceLocalExecutionState";

/** Native Obsidian dialog; no execution starts until a verified or explicitly new identity is returned. */
export class InstallationRecoveryModal<T> extends Modal {
  private busy = false;
  private confirmNew = false;
  private settled = false;
  private error: unknown;
  constructor(app: App, error: unknown, private readonly attempt: (startNew: boolean) => Promise<T>,
    private readonly done: (value: T | undefined) => void) { super(app); this.error = error; }
  onOpen(): void { this.render(); }
  onClose(): void { if (!this.settled) { this.settled = true; this.done(undefined); } this.contentEl.empty(); }
  close(): void { if (!this.busy) super.close(); }
  dispose(): void { this.busy = false; super.close(); }
  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText("Confirm this device’s installation identity");
    const recoverable = this.error instanceof LegacyInstallationRecoveryRequired;
    this.contentEl.createEl("p", {text: this.confirmNew
      ? "Create a new installation and sign in again. Existing tasks, credentials and files are retained, but this device will not take over those tasks."
      : recoverable ? "The original installation could not be verified. Existing tasks and data are retained and will not run until ownership is confirmed."
      : "Device execution records are unavailable. Restore the original device data before continuing. Signing in must not replace its retained identity."});
    const buttons = new Setting(this.contentEl);
    if (this.confirmNew) {
      buttons.addButton(b => b.setButtonText("Back").setDisabled(this.busy).onClick(() => {this.confirmNew = false; this.render();}));
      buttons.addButton(b => {
        // Preserve Obsidian 1.11 compatibility without calling the deprecated setWarning API.
        b.buttonEl.classList.add("mod-warning");
        b.setButtonText("Confirm new device").setDisabled(this.busy).onClick(() => {void this.run(true);});
      });
    } else {
      buttons.addButton(b => b.setButtonText("Retry original installation").setCta().setDisabled(this.busy).onClick(() => {void this.run(false);}));
      if (this.error instanceof LegacyInstallationRecoveryRequired && this.error.canStartNew) buttons.addButton(b => b.setButtonText("Start as a new device").setDisabled(this.busy)
        .onClick(() => {this.confirmNew = true; this.render();}));
    }
    buttons.addButton(b => b.setButtonText("Cancel").setDisabled(this.busy).onClick(() => this.close()));
    if (this.busy) this.contentEl.createEl("p", {text: "Checking installation…", attr: {role: "status"}});
    this.contentEl.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }
  private async run(startNew: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.render();
    try {
      const value = await this.attempt(startNew);
      if (this.settled) return;
      this.settled = true; this.busy = false; this.done(value); this.close();
    } catch (error) { if (this.settled) return; this.error = error; this.confirmNew = false; this.busy = false; this.render(); }
  }
}
