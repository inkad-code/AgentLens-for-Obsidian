import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownPreview, MarkdownPreviewContext } from "../src/ui/workbench/MarkdownPreview";

it("keeps remote image DOM alive when the destination folder changes", () => {
  const cleanup = vi.fn();
  const renderer = vi.fn((_markdown: string, element: HTMLElement) => {
    element.appendChild(document.createElement("img"));
    return cleanup;
  });
  const preview = (path: string) => <MarkdownPreviewContext.Provider value={renderer}>
    <MarkdownPreview markdown="![Media preview](https://cdn.example/image.jpg)" sourcePath={path} />
  </MarkdownPreviewContext.Provider>;
  const view = render(preview("Inbox/post.md"));
  const image = view.container.querySelector("img");
  view.rerender(preview("Research/post.md"));
  expect(renderer).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector("img")).toBe(image);
  expect(cleanup).not.toHaveBeenCalled();
  view.unmount();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it.each(["![photo][image]\n\n[image]: attachments/photo.jpg", "![[attachments/photo.jpg]]", "![photo](attachments/photo.jpg)", '<img src="attachments/photo.jpg">'])("updates relative attachment resolution for %s", markdown => {
  const renderer = vi.fn(() => () => {});
  const preview = (path: string) => <MarkdownPreviewContext.Provider value={renderer}>
    <MarkdownPreview markdown={markdown} sourcePath={path} />
  </MarkdownPreviewContext.Provider>;
  const view = render(preview("Inbox/post.md"));
  view.rerender(preview("Research/post.md"));
  expect(renderer).toHaveBeenCalledTimes(2);
  expect(renderer.mock.calls.at(-1)).toEqual([markdown, expect.any(HTMLElement), "Research/post.md"]);
});
