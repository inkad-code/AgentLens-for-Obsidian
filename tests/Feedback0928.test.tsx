import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FolderField, FolderTree, VaultFoldersContext } from "@/ui/workbench/FolderField";
import { NoteProperties } from "@/ui/workbench/NoteProperties";

describe("0928 feedback", () => {
  it("refreshes folders each time the picker opens without resetting its selection", () => {
    let currentPaths = ["Inbox"];
    const refresh = vi.fn();
    function Picker() {
      const [paths, setPaths] = useState(currentPaths);
      const [value, setValue] = useState("Inbox");
      const [reload] = useState(() => () => { refresh(); setPaths([...currentPaths]); });
      return <VaultFoldersContext.Provider value={{ name: "Vault", counts: {}, paths, refresh: reload }}>
        <FolderField label="Folder" value={value} onChange={setValue} />
      </VaultFoldersContext.Provider>;
    }
    render(<Picker />);
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Browse folder" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    currentPaths = ["Inbox", "New folder"];
    fireEvent.click(screen.getByRole("button", { name: "Browse folder" }));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("treeitem", { name: "New folder" })).toBeVisible();
    expect(screen.getByLabelText("Selected folder path")).toHaveValue("Inbox");
    fireEvent.click(screen.getByRole("treeitem", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Folder")).toHaveValue("New folder");
  });

  it("groups interleaved loaded folders under their actual parents and selects the full path", () => {
    function Picker() {
      const [value, setValue] = useState("Social Reads");
      return <VaultFoldersContext.Provider value={{ name: "Vault", counts: {}, paths: [
        "Social Reads", "Other", "Attachments", "Attachments/Inbox", "Social Reads/Douyin", "Other/Douyin"
      ] }}><FolderTree value={value} onChange={setValue} /><output>{value}</output></VaultFoldersContext.Provider>;
    }
    render(<Picker />);
    expect(screen.getAllByRole("treeitem").map(row => row.dataset.path)).toEqual([
      "Attachments", "Attachments/Inbox", "Other", "Other/Douyin", "Social Reads", "Social Reads/Douyin"
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Social Reads" }));
    expect(screen.queryByRole("treeitem", { name: "Social Reads/Douyin" })).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Attachments/Inbox" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Social Reads" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Social Reads/Douyin" }));
    expect(screen.getByRole("status")).toHaveTextContent("Social Reads/Douyin");
    expect(screen.getByRole("treeitem", { name: "Social Reads/Douyin" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Expand Social Reads/Douyin" })).not.toBeInTheDocument();
  });

  it("displays every write-plan property, including empty values, without interpreting HTML", () => {
    const properties = { Platform: "x", Creator_name: "<script>unsafe</script>", Creator_url: null,
      Source_url: "https://x.com/a/status/1", Published_at: null, Fetched_at: "2026-09-28T01:00:00Z",
      Media_count: 0, Media_policy: "link_only", tags: ["x", "a"] };
    render(<NoteProperties frontmatter={properties} />);
    const region = screen.getByRole("region", { name: "Note properties" });
    expect(within(region).getAllByRole("term").map(term => term.textContent)).toEqual(Object.keys(properties));
    expect(within(region).getAllByRole("definition").map(value => value.textContent)).toEqual([
      "x", "<script>unsafe</script>", "—", properties.Source_url, "—", properties.Fetched_at, "0", "link_only", "x, a"
    ]);
    expect(region.querySelector("script")).toBeNull();
  });
});
