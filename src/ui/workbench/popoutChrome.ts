/** Desktop AgentLens pop-out opens at this size; width stays locked while the window is dedicated. */
export const WORKBENCH_POPOUT_SIZE = { width: 720, height: 900 } as const;

/** Obsidian exposes its Electron window on each desktop pop-out's Window. */
type ElectronHostWindow = {
  setWindowButtonVisibility?: (visible: boolean) => void;
  isDestroyed?: () => boolean;
  getSize?: () => [number, number];
  setSize?: (width: number, height: number) => void;
  getMinimumSize?: () => [number, number];
  getMaximumSize?: () => [number, number];
  setMinimumSize?: (width: number, height: number) => void;
  setMaximumSize?: (width: number, height: number) => void;
  setMaximizable?: (allow: boolean) => void;
  isMaximizable?: () => boolean;
};

type DesktopWindow = Window & { electronWindow?: ElectronHostWindow };

export function compactPopoutChrome(document: Document): () => void {
  const host = document.defaultView as DesktopWindow | null;
  if (!host || !document.body.classList.contains("is-popout-window")) return () => {};
  const native = host.electronWindow;
  let compact = false;
  let savedMinimum: [number, number] | undefined;
  let savedMaximum: [number, number] | undefined;
  let savedMaximizable: boolean | undefined;

  const alive = () => {
    try { return !!native && !native.isDestroyed?.(); }
    catch { return false; }
  };

  const lockWidth = () => {
    if (!alive()) return;
    try {
      savedMinimum ??= native?.getMinimumSize?.();
      savedMaximum ??= native?.getMaximumSize?.();
      if (savedMaximizable === undefined && typeof native?.isMaximizable === "function") {
        savedMaximizable = native.isMaximizable();
      }
      const height = native?.getSize?.()?.[1] ?? WORKBENCH_POPOUT_SIZE.height;
      const minHeight = Math.max(320, savedMinimum?.[1] ?? 320);
      const maxHeight = Math.max(minHeight, savedMaximum?.[1] && savedMaximum[1] > 0 ? savedMaximum[1] : 10_000);
      native?.setSize?.(WORKBENCH_POPOUT_SIZE.width, height);
      // Native width limits avoid resize/setSize feedback during cross-display DPI changes.
      native?.setMinimumSize?.(WORKBENCH_POPOUT_SIZE.width, minHeight);
      native?.setMaximumSize?.(WORKBENCH_POPOUT_SIZE.width, maxHeight);
      native?.setMaximizable?.(false);
    } catch { /* Host may omit optional Electron size APIs. */ }
  };

  const unlockWidth = () => {
    if (!alive()) {
      savedMinimum = undefined;
      savedMaximum = undefined;
      savedMaximizable = undefined;
      return;
    }
    try {
      if (savedMinimum) native?.setMinimumSize?.(savedMinimum[0], savedMinimum[1]);
      if (savedMaximum) native?.setMaximumSize?.(savedMaximum[0], savedMaximum[1]);
      if (savedMaximizable !== undefined) native?.setMaximizable?.(savedMaximizable);
    } catch { /* The native window may already be closing. */ }
    savedMinimum = undefined;
    savedMaximum = undefined;
    savedMaximizable = undefined;
  };

  const setCompact = (next: boolean) => {
    if (compact === next) return;
    compact = next;
    document.body.classList.toggle("agentlens-frameless", next);
    try {
      if (alive()) native?.setWindowButtonVisibility?.(!next);
    } catch { /* The native window may already be closing. */ }
    if (next) lockWidth();
    else unlockWidth();
  };

  const update = () => {
    const leaves = document.querySelectorAll(".workspace-leaf-content");
    setCompact(leaves.length === 1 && leaves[0]?.getAttribute("data-type") === "agentlens-workbench");
  };

  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  update();
  return () => {
    observer.disconnect();
    setCompact(false);
  };
}
