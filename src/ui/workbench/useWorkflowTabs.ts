import { useEffect, useState, type KeyboardEvent } from "react";
import type { WorkbenchTab } from "./types";

export const WORKBENCH_TABS: ReadonlyArray<{ id: WorkbenchTab; label: string }> = [
  { id: "single", label: "Single Fetch" },
  { id: "bulk", label: "Bulk Fetch" },
  { id: "auto", label: "Auto-Fetch" }
];

export function useWorkflowTabs(initialTab: WorkbenchTab, onDirtyStateChange?: (dirty: boolean) => void) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(initialTab);
  const [drafts, setDrafts] = useState<Record<WorkbenchTab, boolean>>({ single: false, bulk: false, auto: false });
  const [resetVersions, setResetVersions] = useState<Record<WorkbenchTab, number>>({ single: 0, bulk: 0, auto: 0 });

  useEffect(() => {
    onDirtyStateChange?.(Object.values(drafts).some(Boolean));
  }, [drafts, onDirtyStateChange]);

  function setDraft(tab: WorkbenchTab, dirty: boolean): void {
    setDrafts((current) => current[tab] === dirty ? current : { ...current, [tab]: dirty });
  }

  function requestTab(tab: WorkbenchTab): void {
    setActiveTab(tab);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: WorkbenchTab): void {
    const tabs = WORKBENCH_TABS.filter((candidate) => candidate.id !== "auto");
    const currentIndex = tabs.findIndex((candidate) => candidate.id === tab);
    const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    const nextButton = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
    requestTab(next.id);
    nextButton?.focus();
  }

  return {
    activeTab, resetVersions, setDraft, requestTab, handleKeyDown
  };
}
