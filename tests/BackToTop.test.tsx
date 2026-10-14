import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackToTop } from "../src/ui/workbench/BackToTop";

function mountAt(top: number) {
  const container = document.createElement("div");
  container.className = "agentlens-workbench__body";
  container.scrollTop = top;
  container.scrollTo = vi.fn();
  document.body.append(container);
  const rendered = render(<BackToTop />, { container });
  return rendered;
}
afterEach(() => vi.restoreAllMocks());

describe("BackToTop", () => {
  it("returns the restored scroll container to the top before any scroll event", () => {
    const windowScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = mountAt(500);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(windowScroll).not.toHaveBeenCalled();
  });
  it("does not lose the container when a window scroll event arrives last", () => {
    const { container } = mountAt(0);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
    container.scrollTop = 650;
    fireEvent.scroll(container);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    container.scrollTop = 0;
    fireEvent.scroll(container);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });
});
