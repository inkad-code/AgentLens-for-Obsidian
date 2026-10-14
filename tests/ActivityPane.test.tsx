import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityPane } from "@/ui/ActivityPane";
import type { ActivityWorkbenchPort } from "@/workbench/ports";
import type { ActivityDetail, ActivityExport } from "@/api/AgentLensApiClient";

const summary = {
  activityId: "activity-11111111",
  operation: "auto_fetch" as const,
  platform: "youtube",
  targetAlias: "Researcher",
  occurredAt: "2026-08-20T00:00:00Z",
  result: "partial" as const,
  chargedUnits: 1,
  relativeNotePath: "AgentLens/Inbox/",
  fileCount: 2,
  deleted: true
};

function service(overrides: Partial<ActivityWorkbenchPort> = {}): ActivityWorkbenchPort {
  return {
    activity: vi.fn().mockResolvedValue({ items: [summary], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" }),
    activityDetail: vi.fn().mockResolvedValue({
      summary,
      diagnostics: {
        requestId: "request-1234567890", fetchId: "fetch-1234567890", runId: "run-1234567890",
        cursorRef: "abc123def456", pageNumber: 2, trigger: "catch_up", chargedUnits: 1,
        reusedExisting: true, errorCode: "VAULT_WRITE_INCOMPLETE", errorSummary: "1 of 2 note writes was incomplete."
      }
    }),
    exportActivity: vi.fn().mockResolvedValue({ schema: "obsidian-activity-v1", generatedAt: "2026-08-20T00:00:00Z", retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z", truncated: false, items: [] }),
    ...overrides
  };
}

describe("ActivityPane", () => {
  it("reveals a back-to-top control after meaningful scrolling", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    render(<ActivityPane service={service()} onBack={vi.fn()} />);
    await screen.findByText("Deleted instance", { exact: false });
    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();

    window.scrollY = 400;
    fireEvent.scroll(window);
    const button = await screen.findByRole("button", { name: "Back to top" });
    fireEvent.click(button);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("renders and filters Creator lifecycle operations", async () => {
    const lifecycle = {
      ...summary,
      activityId: "activity-lifecycle",
      operation: "creator_settings" as const,
      result: "success" as const,
      chargedUnits: 0,
      relativeNotePath: null,
      fileCount: 0,
      deleted: false
    };
    const activity = vi.fn().mockResolvedValue({
      items: [lifecycle], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90,
      retainedFrom: "2026-06-07T00:00:00Z"
    });
    render(<ActivityPane service={service({ activity })} onBack={vi.fn()} />);

    expect(await screen.findByText("Creator settings changed")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Activity operation"), { target: { value: "creator_delete" } });
    await waitFor(() => expect(activity).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: "creator_delete" })
    ));
    expect(screen.getByRole("option", { name: "Creator deleted" })).toBeVisible();
  });

  it("renders filters, deleted history and controlled diagnostics from server DTOs", async () => {
    const api = service();
    render(<ActivityPane service={api} onBack={vi.fn()} />);

    expect(await screen.findByText("Deleted instance", { exact: false })).toBeVisible();
    expect(screen.getByText("AgentLens/Inbox/")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(await screen.findByRole("complementary", { name: "Activity diagnostics" })).toBeVisible();
    expect(screen.getByText("request-…7890")).toBeVisible();
    expect(screen.getByText("abc123def456")).toBeVisible();
    expect(screen.getByText("reused_existing")).toBeVisible();
    expect(screen.queryByText(/token|Cookie|signed URL|\/Users\//i)).not.toBeInTheDocument();
    expect(api.activityDetail).toHaveBeenCalledWith("activity-11111111");
  });

  it("refetches only Activity when filters change and reports read-only failures", async () => {
    const activity = vi.fn()
      .mockResolvedValueOnce({ items: [], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" })
      .mockRejectedValueOnce(new Error("Activity schema unavailable"));
    const api = service({ activity });
    render(<ActivityPane service={api} onBack={vi.fn()} />);
    await screen.findByText("No activity for these filters");

    fireEvent.change(screen.getByLabelText("Activity operation"), { target: { value: "single_fetch" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("This information couldn’t be loaded. Try again.");
    expect(screen.getByRole("alert")).toHaveTextContent("No fetch, retry, usage or scheduler action was started");
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
  });

  it("loads an opaque-cursor page without duplicating overlapping activity records", async () => {
    const second = { ...summary, activityId: "activity-22222222", targetAlias: "Second creator", deleted: false };
    const activity = vi.fn()
      .mockResolvedValueOnce({ items: [summary], through: "2026-08-21T00:00:00Z", nextCursor: "opaque.cursor.signature", pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" })
      .mockResolvedValueOnce({ items: [summary, second, second], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" });
    const api = service({ activity });
    render(<ActivityPane service={api} onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/Second creator/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(2);
    expect(screen.getAllByText(/Researcher/)).toHaveLength(1);
    expect(activity).toHaveBeenLastCalledWith(expect.any(Object), "opaque.cursor.signature", "2026-08-21T00:00:00Z");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("drops a late cursor page after the Activity filters change", async () => {
    let resolveOldPage!: (value: unknown) => void;
    const oldPage = new Promise((resolve) => { resolveOldPage = resolve; });
    const filtered = { ...summary, activityId: "activity-filtered", targetAlias: "Filtered creator", operation: "single_fetch" as const };
    const stale = { ...summary, activityId: "activity-stale", targetAlias: "Stale creator" };
    const activity = vi.fn()
      .mockResolvedValueOnce({ items: [summary], through: "2026-08-21T00:00:00Z", nextCursor: "old.cursor", pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" })
      .mockImplementationOnce(() => oldPage)
      .mockResolvedValueOnce({ items: [filtered], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" });
    const api = service({ activity });
    render(<ActivityPane service={api} onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Activity operation"), { target: { value: "single_fetch" } });
    expect(await screen.findByText(/Filtered creator/)).toBeVisible();
    resolveOldPage({ items: [stale], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" });

    await waitFor(() => expect(screen.queryByText(/Stale creator/)).not.toBeInTheDocument());
    expect(screen.getByText(/Filtered creator/)).toBeVisible();
    expect(screen.queryByText(/Researcher/)).not.toBeInTheDocument();
  });

  it("drops late Activity detail after the filters change", async () => {
    let resolveDetail!: (value: ActivityDetail) => void;
    const delayedDetail = new Promise<ActivityDetail>((resolve) => { resolveDetail = resolve; });
    const filtered = { ...summary, activityId: "activity-filtered", targetAlias: "Filtered creator", operation: "single_fetch" as const };
    const activity = vi.fn()
      .mockResolvedValueOnce({ items: [summary], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" })
      .mockResolvedValueOnce({ items: [filtered], through: "2026-08-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" });
    const activityDetail = vi.fn(() => delayedDetail);
    const api = service({ activity, activityDetail });
    render(<ActivityPane service={api} onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    await waitFor(() => expect(activityDetail).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Activity operation"), { target: { value: "single_fetch" } });
    expect(await screen.findByText(/Filtered creator/)).toBeVisible();
    resolveDetail({
      summary,
      diagnostics: {
        requestId: "stale-request", fetchId: null, runId: null, cursorRef: null,
        pageNumber: null, trigger: null, chargedUnits: 1, reusedExisting: false,
        errorCode: null, errorSummary: null
      }
    });

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Activity diagnostics" })).not.toBeInTheDocument());
  });

  it("does not download an export that became stale after filters changed", async () => {
    let resolveExport!: (value: ActivityExport) => void;
    const delayedExport = new Promise<ActivityExport>((resolve) => { resolveExport = resolve; });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:stale-activity");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    const exportActivity = vi.fn(() => delayedExport);
    const api = service({ exportActivity });
    render(<ActivityPane service={api} onBack={vi.fn()} />);
    await screen.findByText("Deleted instance", { exact: false });

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => expect(exportActivity).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Activity result"), { target: { value: "failed" } });
    resolveExport({ schema: "obsidian-activity-v1", generatedAt: "2026-08-20T00:00:00Z", retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z", truncated: false, items: [] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled());
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("exports the current filters as JSON through the read-only endpoint", async () => {
    const api = service();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:activity");
    const revokeObjectURL = vi.fn();
    let downloadedAs = "";
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedAs = this.download;
    });
    render(<ActivityPane service={api} onBack={vi.fn()} />);
    await screen.findByText("Deleted instance", { exact: false });

    fireEvent.change(screen.getByLabelText("Activity operation"), { target: { value: "auto_fetch" } });
    fireEvent.change(screen.getByLabelText("Activity result"), { target: { value: "partial" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => expect(api.exportActivity).toHaveBeenCalledWith(expect.objectContaining({ operation: "auto_fetch", result: "partial" })));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const exported = JSON.parse(await blob.text()) as { schema: string; items: unknown[] };
    expect(exported).toEqual(expect.objectContaining({ schema: "obsidian-activity-v1", items: [] }));
    expect(downloadedAs).toBe("agentlens-obsidian-activity.json");
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:activity");
    click.mockRestore();
  });
});
