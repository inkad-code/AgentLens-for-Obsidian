import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { createLegacyOwnershipVerifier } from "../src/runtime/LegacyOwnershipBootstrap";
import { openDeviceLocalExecutionState } from "../src/runtime/DeviceLocalExecutionState";
import { SecretTokenStore } from "../src/runtime/SecretTokenStore";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
function fixture() {
  const values = new Map<string, string>();
  const secrets = new SecretTokenStore({getSecret: id => values.get(id) ?? null,
    setSecret: (id, value) => {values.set(id, value);}});
  const secretId = secrets.setRefreshToken("original", "local-token");
  const legacy = {schemaVersion: 1, installationId: "original", refreshTokenSecretId: secretId,
    ledger: {}, pendingActions: [{id: "pending", kind: "remote_action", createdAt: "now", payload: {}}],
    creatorDiagnostics: {}, uiPreferences: {}};
  const api = {refresh: vi.fn(async () => ({accessToken: "access", expiresIn: 3600, refreshToken: "rotated"})),
    account: vi.fn(async () => ({installationId: "original", user: {id: "owner"}})),
    startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn()};
  const factory = vi.fn(() => api);
  const hostValues = new Map<string, unknown>();
  const host = {loadLocalStorage: (key: string) => hostValues.get(key),
    saveLocalStorage: (key: string, value: unknown) => {hostValues.set(key, value);}};
  const shared = {loadData: async () => structuredClone({agentlensState: legacy}), saveData: vi.fn(async () => {})};
  const verify = createLegacyOwnershipVerifier(secrets, factory);
  return {values, secrets, secretId, legacy, api, factory, hostValues, shared,
    open: () => openDeviceLocalExecutionState(host, shared, verify)};
}

it("restores once before migration and retains original pending operations and namespace", async () => {
  const f = fixture(); const execution = await f.open();
  expect(execution.operationNamespace).toBe("obsidian");
  expect(await execution.stateStore.load()).toMatchObject(f.legacy);
  expect(f.api.refresh).toHaveBeenCalledTimes(1);
  expect(f.secrets.getRefreshToken(f.secretId)).toBe("rotated");
  expect(f.shared.saveData).not.toHaveBeenCalled();
  await f.open(); expect(f.api.refresh).toHaveBeenCalledTimes(1);
});

it("rejects copied shared records without a host credential before any API request or reservation", async () => {
  const f = fixture(); f.values.clear();
  await expect(f.open()).rejects.toThrow("Verify");
  expect(f.factory).not.toHaveBeenCalled(); expect(f.hostValues.size).toBe(0);
  expect(f.shared.saveData).not.toHaveBeenCalled();
});

it("preserves recovery evidence when the server identity does not match", async () => {
  const f = fixture(); f.api.account.mockResolvedValue({installationId: "foreign", user: {id: "owner"}});
  await expect(f.open()).rejects.toThrow("Verify");
  expect(f.hostValues.size).toBe(0); expect(f.shared.saveData).not.toHaveBeenCalled();
  expect(f.secrets.getRefreshToken(f.secretId)).toBe("rotated");
});

it("does not create a replacement installation after a refresh outage", async () => {
  const f = fixture(); f.api.refresh.mockRejectedValue(new Error("offline"));
  await expect(f.open()).rejects.toThrow();
  expect(f.hostValues.size).toBe(0); expect(f.api.account).not.toHaveBeenCalled();
  expect(f.secrets.getRefreshToken(f.secretId)).toBe("local-token");
  expect(f.shared.saveData).not.toHaveBeenCalled();
});
