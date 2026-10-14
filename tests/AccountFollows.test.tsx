import { AgentLensError } from "@/core/errors";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountFollowsDialog } from "@/ui/workbench/AccountFollowsDialog";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import type { AutoFetchWorkbenchPort } from "@/workbench/ports";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

const follow = { followId: "follow", configRevision: 3, creator: { platform: "youtube", displayName: "Creator", handle: null, profileUrl: "https://youtube.com/@creator" },
  frequency: { every: 2, unit: "hour" as const }, autoFetchEnabled: false };
const identity = { installationId: "installation", deviceId: "device", clientVersion: "0.1.1", obsidianVersion: "1.13.7", platform: "desktop_macos" as const };
function api(data: unknown) {
  const requests: TransportRequest[] = [];
  const transport: JsonTransport = { json: async (request, validate) => { requests.push(request); return validate({ success: true, data }); } };
  return { client: new AgentLensApiClient(transport, identity), requests };
}

describe("account Follow discovery", () => {
  it("unfollows through the signed shared endpoint and requires an explicit acknowledgement", async () => {
    const fixture = api({ removed: true });
    await fixture.client.unfollowAccount("access", "follow/1");
    expect(fixture.requests).toEqual([{ method: "DELETE", path: "/v1/plugins/follows/follow%2F1", accessToken: "access", installationId: "installation" }]);
    for (const data of [{ removed: false }, { removed: "true" }, {}]) {
      const invalid = api(data);
      await expect(invalid.client.unfollowAccount("access", "follow")).rejects.toThrow();
      expect(invalid.requests).toHaveLength(1);
    }
  });
  it("requires confirmation, coalesces submissions, and removes only the acknowledged Follow", async () => {
    let finish!: () => void;
    const unfollowAccount = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onUnfollowed = vi.fn();
    const service = { accountFollows: async () => [follow], unfollowAccount } as unknown as AutoFetchWorkbenchPort;
    render(<AccountFollowsDialog service={service} onClose={() => undefined} onUnfollowed={onUnfollowed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unfollow Creator across plugins" }));
    expect(unfollowAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/Saved files and task history will be kept/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep following" }));
    expect(unfollowAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Creator across plugins" }));
    const confirm = screen.getByRole("button", { name: "Confirm account unfollow" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(unfollowAccount).toHaveBeenCalledExactlyOnceWith("follow");
    expect(onUnfollowed).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(screen.getByText("No account follows.")).toBeInTheDocument();
    expect(onUnfollowed).toHaveBeenCalledExactlyOnceWith("follow");
  });
  it("retains uncertain cancellations and requires a fresh query before another action", async () => {
    const accountFollows = vi.fn(async () => [follow]);
    const unfollowAccount = vi.fn().mockRejectedValue(new Error("Connection lost"));
    const onUnfollowed = vi.fn();
    render(<AccountFollowsDialog service={{ accountFollows, unfollowAccount } as unknown as AutoFetchWorkbenchPort} onClose={() => undefined} onUnfollowed={onUnfollowed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unfollow Creator across plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm account unfollow" }));
    await screen.findByText(/We couldn’t confirm whether this creator was unfollowed/);
    expect(screen.getByRole("button", { name: "Unfollow Creator across plugins" })).toBeDisabled();
    expect(onUnfollowed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry account follows" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unfollow Creator across plugins" })).toBeEnabled());
    expect(unfollowAccount).toHaveBeenCalledTimes(1);
    expect(accountFollows).toHaveBeenCalledTimes(2);
  });
  it("does not apply a prior account's late cancellation to the new view", async () => {
    let finish!: () => void;
    const oldService = { accountFollows: async () => [follow], unfollowAccount: () => new Promise<void>(resolve => { finish = resolve; }) } as unknown as AutoFetchWorkbenchPort;
    const onUnfollowed = vi.fn();
    const view = render(<AccountFollowsDialog service={oldService} onClose={() => undefined} onUnfollowed={onUnfollowed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unfollow Creator across plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm account unfollow" }));
    const newService = { accountFollows: async () => [{ ...follow, creator: { ...follow.creator, displayName: "New account creator" } }] } as unknown as AutoFetchWorkbenchPort;
    view.rerender(<AccountFollowsDialog service={newService} onClose={() => undefined} onUnfollowed={onUnfollowed} />);
    await screen.findByText("New account creator");
    await act(async () => finish());
    expect(screen.getByText("New account creator")).toBeInTheDocument();
    expect(onUnfollowed).not.toHaveBeenCalled();
  });
  it("returns to the preceding page after removing its final row", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ ...follow, followId: `f${i}`, creator: { ...follow.creator, displayName: `Creator ${i}` } }));
    const service = { accountFollows: async () => rows, unfollowAccount: async () => undefined } as unknown as AutoFetchWorkbenchPort;
    render(<AccountFollowsDialog service={service} onClose={() => undefined} />);
    await screen.findByText("Creator 0");
    fireEvent.click(screen.getByRole("button", { name: "Next creators" }));
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Creator 25 across plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm account unfollow" }));
    await screen.findByText("25 account follows · Page 1");
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
  });
  it("queries the shared account list without claiming any Vault target", async () => {
    const fixture = api([{ ...follow, binding: { creatorId: "untrusted-local-binding" } }]);
    expect(await fixture.client.accountFollows("access")).toEqual([follow]);
    expect(fixture.requests).toEqual([{ method: "GET", path: "/v1/plugins/follows", accessToken: "access", installationId: "installation" }]);
  });
  it.each([{ rows: [follow, follow] }, { rows: [{ ...follow, configRevision: 0 }] }, { rows: [{ ...follow, frequency: { every: 1.5, unit: "hour" } }] }, { rows: [{ ...follow, autoFetchEnabled: "false" }] }])("rejects invalid account configuration %#", async ({ rows }) => {
    await expect(api(rows).client.accountFollows("access")).rejects.toThrow();
  });
  it("does not show failed queries as an empty account and retries explicitly", async () => {
    const accountFollows = vi.fn().mockRejectedValueOnce(new AgentLensError("unknown", "Service unavailable", false, 404, undefined, "query-request-123456789")).mockResolvedValueOnce([]);
    render(<AccountFollowsDialog service={{ accountFollows } as unknown as AutoFetchWorkbenchPort} onClose={() => undefined} />);
    await screen.findByText(/This information couldn’t be loaded. Try again./);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Request query-");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Retry is not safe");
    expect(screen.queryByText("No account follows.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry account follows" }));
    expect(await screen.findByText("No account follows.")).toBeInTheDocument();
    expect(accountFollows).toHaveBeenCalledTimes(2);
  });
  it("renders bounded pages without activating or rebinding any creator", async () => {
    const accountFollows = vi.fn(async () => Array.from({ length: 26 }, (_, i) => ({ ...follow, followId: `f${i}`, creator: { ...follow.creator, displayName: `Creator ${i}` } })));
    render(<AccountFollowsDialog service={{ accountFollows } as unknown as AutoFetchWorkbenchPort} onClose={() => undefined} />);
    await screen.findByText("Creator 0");
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(screen.queryByText("Creator 25")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next creators" }));
    expect(screen.getByText("Creator 25")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Previous creators" }));
    expect(screen.getByText("Creator 0")).toBeInTheDocument();
    expect(accountFollows).toHaveBeenCalledTimes(1);
  });
});
