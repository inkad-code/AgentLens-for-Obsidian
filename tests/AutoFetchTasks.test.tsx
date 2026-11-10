import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutoFetchTasks, AutoFetchImportStatus } from "@/ui/workbench/AutoFetchTasks";
import type { ImportTask } from "@/workbench/ImportTasks";
import type { AutoFetchWorkbenchPort } from "@/workbench/ports";
import { I18nProvider } from "@/i18n/I18nProvider";

const task = {
  id: "task", accountId: "account", installationId: "install", creatorId: "creator", creatorName: "Creator",
  folderPath: "Inbox", requestId: "request-1", time: "2026-10-20T00:00:00Z", phase: "downloading",
  notes: [{ key: "youtube:one", path: "Inbox/note.md", phase: "saving", preview: { post: { platform: "youtube", author: { displayName: "Creator" } } },
    files: [{ id: "media", name: "video.mp4", phase: "downloading", receivedBytes: 1048576 }] }]
} as ImportTask;
const completedText = { ...task, phase: "saved" as const, notes: [{ ...task.notes[0]!, phase: "saved" as const, files: [] }] };

describe("Auto Fetch task experience", () => {
  it("loads older durable history and changes the history query with the filter", async () => {
    const older = { ...completedText, id: "older", creatorName: "Older creator" };
    const importTaskHistory = vi.fn(async (cursor?: string, filter?: string) => filter === "failed" ? { tasks: [] }
      : cursor ? { tasks: [older] } : { tasks: [task], nextCursor: "older-cursor" });
    render(<AutoFetchTasks tasks={[task]} loading={false} service={{ importTaskHistory } as unknown as AutoFetchWorkbenchPort} onBack={vi.fn()} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => expect(screen.getByText("Older creator")).toBeVisible());
    expect(importTaskHistory).toHaveBeenCalledWith("older-cursor", "all");
    fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
    await waitFor(() => expect(importTaskHistory).toHaveBeenCalledWith(undefined, "failed"));
    expect(screen.queryByText("Older creator")).not.toBeInTheDocument();
  });

  it("pages files within a single large note and keeps pure text notes visible", () => {
    const large = structuredClone(task);
    large.phase = "saved";
    large.notes[0]!.phase = "saved";
    large.notes[0]!.files = Array.from({ length: 60 }, (_, index) => ({ id: `file-${index}`, name: `file-${index}.jpg`, phase: "saved", receivedBytes: 4 }));
    large.notes.push({ ...large.notes[0]!, key: "text", path: "Inbox/text-only.md", files: [] });
    const { container } = render(<AutoFetchTasks tasks={[large]} loading={false} onBack={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "View Detail" }));
    expect(container.querySelectorAll(".agentlens-task-file")).toHaveLength(50);
    expect(screen.queryByText("file-50.jpg")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(container.querySelectorAll(".agentlens-task-file")).toHaveLength(10);
    expect(screen.getByText("Note: Inbox/text-only.md")).toBeVisible();
    expect(screen.getByRole("button", { name: "More" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("button", { name: "More" }).parentElement!).getByRole("button", { name: "Back" }));
    expect(container.querySelectorAll(".agentlens-task-file")).toHaveLength(50);
  });

  it("discards an older history response after the account changes", async () => {
    const older = { ...task, id: "old-history", creatorName: "Private old history" };
    const nextAccount = { ...task, id: "new-account", accountId: "other", creatorName: "Other account creator" };
    let release!: (page: { tasks: ImportTask[] }) => void;
    const pendingPage = new Promise<{ tasks: ImportTask[] }>(resolve => { release = resolve; });
    const importTaskHistory = vi.fn().mockResolvedValueOnce({ tasks: [task], nextCursor: "cursor" })
      .mockReturnValueOnce(pendingPage).mockResolvedValue({ tasks: [nextAccount] });
    const props = { loading: false, service: { importTaskHistory } as unknown as AutoFetchWorkbenchPort, onBack: vi.fn(), onRefresh: vi.fn() };
    const { rerender } = render(<AutoFetchTasks {...props} tasks={[task]} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    rerender(<AutoFetchTasks {...props} tasks={[nextAccount]} />);
    await waitFor(() => expect(importTaskHistory).toHaveBeenCalledTimes(3));
    release({ tasks: [older] });
    await waitFor(() => expect(screen.queryByText("Private old history")).not.toBeInTheDocument());
    expect(screen.getByText("Other account creator")).toBeVisible();
  });

  it("shows the fetch failure badge and its error in an expandable detail row", () => {
    render(<AutoFetchTasks tasks={[{ ...task, phase: "failed", notes: [], fetchError: "Source unavailable" }]} loading={false} onBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText("Fetching Failed")).toBeVisible();
    expect(screen.queryByText("Source unavailable")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Detail" }));
    expect(screen.getByText("Parsing error")).toBeVisible();
    expect(screen.getByText("Source unavailable")).toBeVisible();
  });

  it("localizes the task page, status link, file states and retry feedback", async () => {
    const retryImportTask = vi.fn(async () => { throw new Error("This task has no failed files to retry."); });
    const completed = completedText;
    render(<I18nProvider locale="zh-CN"><AutoFetchImportStatus tasks={[completed]} loading={false} onClick={vi.fn()} />
      <AutoFetchTasks tasks={[completed]} loading={false} service={{ retryImportTask } as unknown as AutoFetchWorkbenchPort} onBack={vi.fn()} onRefresh={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole("button", { name: "导入完成" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "已完成" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("此任务没有需要重试的失败文件。"));
  });

  it("shows a real-history entry in the empty state and opens it", () => {
    const onClick = vi.fn();
    render(<AutoFetchImportStatus tasks={[]} loading={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Task History" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows unknown-size streams without a made-up percentage and known-size streams with one", () => {
    const props = { tasks: [task], loading: false, onBack: vi.fn(), onRefresh: vi.fn() };
    const { rerender } = render(<AutoFetchTasks {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "View Detail" }));
    expect(screen.getByText("1.0 MB / —")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Downloading video.mp4" })).not.toHaveAttribute("aria-valuenow");
    const known = structuredClone(task);
    known.notes[0]!.files[0]!.totalBytes = 4 * 1048576;
    rerender(<AutoFetchTasks {...props} tasks={[known]} />);
    expect(screen.getByRole("progressbar", { name: "Downloading video.mp4" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("25%")).toBeVisible();
  });

  it("filters failed tasks and retries the original task ID", async () => {
    const retryImportTask = vi.fn(async () => {});
    const service = { retryImportTask } as unknown as AutoFetchWorkbenchPort;
    render(<AutoFetchTasks tasks={[{ ...task, phase: "failed", notes: [] }]} loading={false} service={service} onBack={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Importing" }));
    expect(screen.getByText("No tasks yet")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryImportTask).toHaveBeenCalledWith("task"));
  });

  it("keeps the Eagle creator metadata, result badges and Retry action on completed cards", async () => {
    const retryImportTask = vi.fn(async () => { throw new Error("This task has no failed files to retry."); });
    const completed = structuredClone(task);
    completed.phase = "saved"; completed.platform = "youtube"; completed.handle = "@creator"; completed.credits = 1;
    completed.notes[0]!.phase = "saved"; completed.notes[0]!.files[0]!.phase = "saved";
    render(<AutoFetchTasks tasks={[completed]} loading={false} service={{ retryImportTask } as unknown as AutoFetchWorkbenchPort}
      onBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText("@creator")).toBeVisible();
    expect(screen.getByText("@creator")).toHaveAttribute("title", "@creator");
    expect(screen.getByText("Imported: 1")).toBeVisible();
    expect(screen.getByText("Total: 1")).toBeVisible();
    expect(screen.getByText("1 credits")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This task has no failed files to retry."));
    expect(retryImportTask).toHaveBeenCalledWith("task");
    expect(screen.getByText("Imported: 1")).toBeVisible();
  });

  it("cancel all targets active tasks and retains completed cards", async () => {
    const cancelImportTask = vi.fn(async () => {});
    render(<AutoFetchTasks tasks={[task, { ...completedText, id: "complete", creatorName: "Finished" }]} loading={false}
      service={{ cancelImportTask } as unknown as AutoFetchWorkbenchPort} onBack={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel All Fetch" }));
    await waitFor(() => expect(cancelImportTask).toHaveBeenCalledOnce());
    expect(cancelImportTask).toHaveBeenCalledWith("task");
    const finished = screen.getByText("Finished").closest("article")!;
    expect(within(finished).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});


it("hides successful empty checks in every list while retaining failures and text notes", () => {
  const props = { loading: false, onBack: vi.fn(), onRefresh: vi.fn() };
  const { rerender } = render(<AutoFetchTasks {...props} tasks={[{ ...task, phase: "saved", notes: [], platform: "x", handle: "@elonmusk" }]} />);
  expect(screen.getByText("No tasks yet")).toBeVisible();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
  expect(screen.getByText("No tasks yet")).toBeVisible();
  expect(screen.queryByText("@elonmusk")).not.toBeInTheDocument();
  rerender(<AutoFetchTasks {...props} tasks={[{ ...task, phase: "failed", notes: [] }]} />);
  expect(screen.queryByText("Check completed · No new content")).not.toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: "Retry" }).closest("article")!).getByText("Failed")).toBeVisible();
  rerender(<AutoFetchTasks {...props} tasks={[completedText]} />);
  fireEvent.click(screen.getByRole("button", { name: "View Detail" }));
  expect(screen.getByText("Note: Inbox/note.md")).toBeVisible();
});

it("removes a live empty check after completion even when its earlier state is cached in history", async () => {
  const checking = { ...task, phase: "checking" as const, notes: [] };
  const importTaskHistory = vi.fn(async () => ({ tasks: [checking] }));
  const props = { loading: false, service: { importTaskHistory } as unknown as AutoFetchWorkbenchPort, onBack: vi.fn(), onRefresh: vi.fn() };
  const { rerender } = render(<AutoFetchTasks {...props} tasks={[checking]} />);
  await waitFor(() => expect(importTaskHistory).toHaveBeenCalledOnce());
  expect(screen.getByRole("article")).toBeVisible();
  rerender(<AutoFetchTasks {...props} tasks={[{ ...checking, phase: "saved" }]} />);
  await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
  expect(screen.getByText("No tasks yet")).toBeVisible();
  rerender(<AutoFetchTasks {...props} tasks={[{ ...completedText, id: "next-content", creatorName: "Actual content" }]} />);
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Actual content")).toBeVisible();
  expect(screen.queryByTitle("Creator")).not.toBeInTheDocument();
});

it("shows the history entry when all checks completed without new content", () => {
  render(<AutoFetchImportStatus tasks={[{ ...task, phase: "saved", notes: [] }]} loading={false} onClick={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Check Task History" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Import Completed" })).not.toBeInTheDocument();
});
