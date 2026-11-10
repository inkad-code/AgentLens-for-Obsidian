import { expect, it, vi } from "vitest";
import type { AuthState } from "../src/auth/AuthService";
import { LegacyInstallationOwnership } from "../src/runtime/LegacyInstallationOwnership";
import { SecretTokenStore } from "../src/runtime/SecretTokenStore";

function fixture() {
  const values = new Map<string, string>();
  const secrets = new SecretTokenStore({getSecret: id => values.get(id) ?? null, setSecret: (id, value) => {values.set(id, value);}});
  const secretId = secrets.setRefreshToken("original", "local-credential");
  let epoch = 1; let state: AuthState = {status: "signed_in", accessToken: "access", accessTokenExpiresAt: 2000}; let time = 1000;
  const account = vi.fn(async (_token: string) => ({installationId: "original", user: {id: "owner"}}));
  const verifier = new LegacyInstallationOwnership("original", {snapshot: () => state, sessionEpoch: () => epoch}, secrets, {account}, () => time);
  return {verifier, secrets, values, account, legacy: {installationId: "original", refreshTokenSecretId: secretId},
    setState: (next: AuthState) => {state = next;}, nextEpoch: () => {epoch++;}, expire: () => {time = 2001;}};
}
it("verifies local credential possession against the existing installation session without rotating it", async () => {
  const f = fixture(); const before = [...f.values];
  expect(await f.verifier.verify(f.legacy)).toBe(true); expect(f.account).toHaveBeenCalledWith("access");
  expect([...f.values]).toEqual(before);
});
it("does not infer ownership from copied secret references or foreign installation state", async () => {
  const f = fixture();
  expect(await f.verifier.verify({...f.legacy, installationId: "foreign"})).toBe(false);
  expect(await f.verifier.verify({...f.legacy, refreshTokenSecretId: "other"})).toBe(false);
  f.values.clear(); expect(await f.verifier.verify(f.legacy)).toBe(false); expect(f.account).not.toHaveBeenCalled();
});
it("does not refresh credentials to recover a missing or expired session during migration", async () => {
  const f = fixture(); f.expire(); expect(await f.verifier.verify(f.legacy)).toBe(false);
  f.setState({status: "signed_out"}); expect(await f.verifier.verify(f.legacy)).toBe(false);
  expect(f.account).not.toHaveBeenCalled(); expect(f.values.size).toBe(1);
});
it.each(["epoch", "token", "credential", "expiry"])("rejects %s changes during the server observation", async change => {
  const f = fixture(); f.account.mockImplementation(async () => {
    if (change === "epoch") f.nextEpoch();
    if (change === "token") f.setState({status: "signed_in", accessToken: "other", accessTokenExpiresAt: 2000});
    if (change === "credential") f.secrets.setRefreshToken("original", "replacement");
    if (change === "expiry") f.expire();
    return {installationId: "original", user: {id: "owner"}};
  });
  expect(await f.verifier.verify(f.legacy)).toBe(false);
});
it("rejects another installation or missing account identity", async () => {
  const f = fixture(); f.account.mockResolvedValue({installationId: "other", user: {id: "owner"}});
  expect(await f.verifier.verify(f.legacy)).toBe(false);
  f.account.mockResolvedValue({installationId: "original", user: {id: ""}});
  expect(await f.verifier.verify(f.legacy)).toBe(false);
});
it("preserves credential evidence when account verification is unavailable", async () => {
  const f = fixture(); const before = [...f.values]; f.account.mockRejectedValue(new Error("offline"));
  await expect(f.verifier.verify(f.legacy)).rejects.toThrow("offline"); expect([...f.values]).toEqual(before);
});
