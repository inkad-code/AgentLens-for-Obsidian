import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthState } from "../src/auth/AuthService";
import { AgentLensError } from "../src/core/errors";
import { ManualTrial, TrialDeviceStore, type TrialApi, type TrialExperience, type TrialReply } from "../src/workbench/ManualTrial";

const scope = "http://127.0.0.1:18080/api";
const poster = { mode: "single_post" as const, url: "https://x.com/trial/status/421" };
const initial: TrialExperience = { mode: "B", enrollmentId: "shared", trial: { remaining: 3, reserved: 0, settled: 0, accountLinked: false } };

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

function fixture() {
  let authState: AuthState = { status: "signed_out" };
  let generation = 0;
  const auth = {
    snapshot: () => authState,
    sessionEpoch: () => generation,
    accessToken: async () => authState.status === "signed_in" ? authState.accessToken : null
  };
  const api = {
    experience: vi.fn<TrialApi["experience"]>(async () => initial),
    link: vi.fn<TrialApi["link"]>(async () => ({ ...initial, trial: { ...initial.trial!, accountLinked: true } })),
    fetch: vi.fn<TrialApi["fetch"]>(), recover: vi.fn<TrialApi["recover"]>()
  };
  return {
    api,
    client: () => new ManualTrial(api, new TrialDeviceStore(scope), auth),
    signIn: () => { generation++; authState = { status: "signed_in", accessToken: "original-plugin-session", accessTokenExpiresAt: Date.now() + 600_000 }; }
  };
}

const completed: TrialReply = { operationId: "original-op", status: "success_empty",
  balance: { remaining: 2, settled: 1, reserved: 0, accountLinked: true },
  page: { fetchId: "original-op", content: [], mode: "single_post", platform: "x", page: null,
    usage: { charged: false, units: 0, remaining: null }, trial: { outcome: "success_empty" } } };

it("uses one device credential across workbench windows and never enrolls on status reads", async () => {
  const f = fixture();
  const a = f.client(), b = f.client();
  expect(await a.status()).toEqual({ recoverSingle: false, recoverProfile: false });
  expect(f.api.experience).not.toHaveBeenCalled();
  await Promise.all([a.start(), b.start()]);
  const [first, second] = f.api.experience.mock.calls;
  expect(first?.[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second?.[0]).toBe(first?.[0]);
  await expect(f.client().status()).resolves.toMatchObject({ mode: "B", balance: { remaining: 3 } });
  expect((await Promise.all([a.claimSavePrompt(), b.claimSavePrompt()])).sort()).toEqual([false, true]);
});

it("uses the original key on reload and uses the linked account when the original operation ID is unknown", async () => {
  const f = fixture();
  const a = f.client();
  await a.start();
  f.api.fetch.mockRejectedValueOnce(new AgentLensError("network_unavailable", "Connection lost", true))
    .mockResolvedValueOnce(completed);
  await expect(a.fetch(poster)).rejects.toThrow("Connection lost");
  f.signIn();
  const b = f.client();
  await expect(b.recover("single_post")).resolves.toMatchObject({ url: poster.url, page: { fetchId: "original-op" } });
  expect(f.api.link).toHaveBeenCalledOnce();
  const [first, replay] = f.api.fetch.mock.calls;
  expect(replay?.slice(0, 3)).toEqual(first?.slice(0, 3));
  expect(replay?.[3]).toBe("original-plugin-session");
  expect((await b.status()).balance?.remaining).toBe(2);
});

it("recovers a known in-flight operation with a read and preserves the original linked account", async () => {
  const f = fixture();
  const a = f.client();
  await a.start();
  f.api.fetch.mockResolvedValueOnce({ operationId: "original-op", status: "processing",
    balance: { remaining: 2, reserved: 1, settled: 0, accountLinked: false } });
  await expect(a.fetch(poster)).rejects.toThrow("still processing");
  f.signIn();
  f.api.recover.mockResolvedValueOnce(completed);
  await expect(f.client().recover("single_post")).resolves.toMatchObject({ page: { fetchId: "original-op" } });
  expect(f.api.recover).toHaveBeenCalledWith("original-op", { token: "original-plugin-session" });
  expect(f.api.fetch).toHaveBeenCalledOnce();
});

it("recovers the exact original profile pages using the saved cursors and receipt IDs", async () => {
  const f = fixture();
  const a = f.client();
  await a.start();
  const base = { mode: "profile_page" as const, url: "https://x.com/trial" };
  const response = (operationId: string, pageNumber: number, cursor: string | null): TrialReply => ({
    ...completed, operationId, status: "success", balance: { ...completed.balance, accountLinked: false },
    page: { ...completed.page!, mode: "profile_page", fetchId: operationId,
      trial: { outcome: "success" }, page: { pageNumber, cursor, hasMore: !!cursor } }
  });
  const one = response("first", 1, "second-cursor");
  const newer = response("another-first", 1, "independent-cursor");
  const two = response("second", 2, null);
  f.api.fetch.mockResolvedValueOnce(one).mockResolvedValueOnce(newer).mockResolvedValueOnce(two);
  await a.fetch(base);
  await a.fetch(base);
  await a.fetch({ ...base, cursor: "second-cursor" });
  f.signIn();
  f.api.recover.mockResolvedValueOnce(two).mockResolvedValueOnce(one);
  const reopened = await f.client().recover("profile_page");
  expect(reopened.pages.map(page => page.fetchId)).toEqual(["first", "second"]);
  expect(f.api.recover.mock.calls).toEqual([["second", { token: "original-plugin-session" }], ["first", { token: "original-plugin-session" }]]);
});
