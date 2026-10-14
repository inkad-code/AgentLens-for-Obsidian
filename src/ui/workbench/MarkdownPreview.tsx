import { createContext, useContext, useEffect, useRef } from "react";

export type MarkdownPreviewRenderer = (markdown: string, element: HTMLElement, sourcePath: string) => () => void;
export const MarkdownPreviewContext = createContext<MarkdownPreviewRenderer | undefined>(undefined);

export function MarkdownPreview({ markdown, sourcePath }: { markdown: string; sourcePath: string }) {
  const render = useContext(MarkdownPreviewContext);
  const element = useRef<HTMLDivElement>(null);
  // Remote-only previews do not depend on the destination folder. Keep their
  // image DOM alive when only the planned note path changes. Vault links still
  // need the actual source path for Obsidian's relative-link resolution.
  const renderPath = /\[\[|!?\[[^\]]*\]\((?!https?:\/\/|mailto:|data:)|<[^>]+(?:src|href)\s*=\s*["'](?!https?:\/\/|data:)|^\s{0,3}\[[^\]]+\]:/im.test(markdown) ? sourcePath : "";
  useEffect(() => {
    if (render && element.current) return render(markdown, element.current, renderPath);
  }, [render, markdown, renderPath]);
  return render ? <div className="agentlens-rendered-note" ref={element} /> : <pre className="agentlens-markdown-preview">{markdown}</pre>;
}
