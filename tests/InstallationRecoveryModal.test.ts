import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
vi.mock("obsidian", () => import("./helpers/NativeModalHarness"));
import { InstallationRecoveryModal } from "../src/ui/InstallationRecoveryModal";
import { LegacyInstallationRecoveryRequired } from "../src/runtime/DeviceLocalExecutionState";
afterEach(() => document.body.replaceChildren());
it("requires a second explicit confirmation and never starts a new identity on cancel", () => {
  const attempt = vi.fn(), done = vi.fn(); const modal = new InstallationRecoveryModal({} as never, new LegacyInstallationRecoveryRequired(true), attempt, done); modal.open();
  expect(screen.getByRole("button", {name: "Retry original installation"})).toHaveFocus();
  fireEvent.click(screen.getByRole("button", {name: "Start as a new device"}));
  expect(attempt).not.toHaveBeenCalled(); expect(screen.getByText(/Existing tasks, credentials and files/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name: "Cancel"})); expect(done).toHaveBeenCalledWith(undefined); expect(attempt).not.toHaveBeenCalled();
});
it("retries failed recovery without clearing evidence and resolves only after confirmation", async () => {
  const attempt = vi.fn().mockRejectedValueOnce(new LegacyInstallationRecoveryRequired(true)).mockResolvedValue({installation: "new"});
  const done = vi.fn(); new InstallationRecoveryModal({} as never, new LegacyInstallationRecoveryRequired(true), attempt, done).open();
  fireEvent.click(screen.getByRole("button", {name: "Retry original installation"}));
  await waitFor(() => expect(screen.getByRole("button", {name: "Start as a new device"})).toBeEnabled());
  expect(attempt).toHaveBeenCalledWith(false); expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Start as a new device"}));
  fireEvent.click(screen.getByRole("button", {name: "Confirm new device"}));
  await waitFor(() => expect(done).toHaveBeenCalledWith({installation: "new"})); expect(attempt).toHaveBeenLastCalledWith(true);
});
it("does not offer a new identity for a missing established database or reserved legacy identity", () => {
  const modal = new InstallationRecoveryModal({} as never, new Error("missing database"), vi.fn(), vi.fn()); modal.open();
  expect(screen.queryByRole("button", {name: "Start as a new device"})).toBeNull(); modal.close();
  new InstallationRecoveryModal({} as never, new LegacyInstallationRecoveryRequired(false), vi.fn(), vi.fn()).open();
  expect(screen.queryByRole("button", {name: "Start as a new device"})).toBeNull();
});
it("ignores repeated confirmation and prevents closing while the authorized migration is running", async () => {
  let finish!: (v: string) => void; const attempt = vi.fn(() => new Promise<string>(r => {finish = r;})), done = vi.fn();
  const modal = new InstallationRecoveryModal({} as never, new LegacyInstallationRecoveryRequired(true), attempt, done); modal.open();
  fireEvent.click(screen.getByRole("button", {name: "Retry original installation"})); modal.close();
  expect(screen.getByRole("dialog")).toBeVisible(); expect(attempt).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
  finish("restored"); await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});
it("does not resume plugin initialization when unloaded during recovery", async () => {
  let finish!: (v: string) => void; const done = vi.fn();
  const modal = new InstallationRecoveryModal({} as never, new LegacyInstallationRecoveryRequired(true), () => new Promise<string>(r => {finish = r;}), done);
  modal.open(); fireEvent.click(screen.getByRole("button", {name: "Retry original installation"})); modal.dispose();
  expect(done).toHaveBeenCalledWith(undefined); finish("restored"); await Promise.resolve();
  expect(done).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).toBeNull();
});
