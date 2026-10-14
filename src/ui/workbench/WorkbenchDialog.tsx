import { useHostDocument, useHostWindow } from "./HostDocument";
import { dialogClose } from "./dialogAssets";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modal keeps keyboard focus inside the setup and returns it to its trigger. */
export function WorkbenchDialog({ title, onClose, children, className = "", placement = "center", compact = false, textClose = false, iconClose = false, closeOnBackdrop = false, hideClose = false }: { hideClose?: boolean; textClose?: boolean; iconClose?: boolean; compact?: boolean; placement?: "center" | "right"; className?: string; title: string; onClose: () => void; children: ReactNode; closeOnBackdrop?: boolean }) {
  const document = useHostDocument();
  const window = useHostWindow();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof window.HTMLElement ? document.activeElement : null;
    const container = element.closest<HTMLElement>('.agentlens-workbench');
    const align = () => {
      if (placement !== 'right' || !container) return;
      const bounds = container.getBoundingClientRect();
      const width = Math.min(472, bounds.width);
      Object.assign(element.style, {left: `${bounds.right-width}px`, top: `${Math.max(0,bounds.top)}px`, width: `${width}px`, height: `${Math.min(bounds.height,window.innerHeight-Math.max(0,bounds.top))}px`});
    };
    align();
    const observer = placement === 'right' && typeof window.ResizeObserver !== 'undefined' ? new window.ResizeObserver(align) : null;
    if (container) observer?.observe(container);
    // Obsidian handles Escape before document-level React handlers. Keep its outer
    // modal open while the browser cancels the innermost native dialog.
    const containEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !(event.target instanceof window.Element)) return;
      if (event.target.closest('dialog') !== element) return;
      event.stopPropagation();
      if (event.target.matches('[role="combobox"][aria-expanded="true"]')) return;
      event.preventDefault();
      element.dispatchEvent(new window.Event('cancel', {cancelable: true}));
    };
    window.addEventListener('keydown', containEscape, true);
    window.addEventListener('agentlens-escape', containEscape as EventListener, true);
    window.addEventListener('resize',align);
    if (element.showModal) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      window.removeEventListener('keydown', containEscape, true); window.removeEventListener('agentlens-escape', containEscape as EventListener, true);
      observer?.disconnect();
      window.removeEventListener('resize',align);
      element.close?.();
      queueMicrotask(() => { if (trigger?.isConnected) trigger.focus(); });
    };
  }, [placement]);
  return <dialog ref={dialog} className={`agentlens-dialog ${compact ? "agentlens-compact-dialog" : ""} ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (!closeOnBackdrop || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header><h2 id={titleId}>{title}</h2>{!hideClose && <button type="button" aria-label="Close dialog" onClick={onClose}>{textClose || (compact && !iconClose) ? <span aria-hidden="true">×</span> : <img src={dialogClose} width="24" height="24" alt="" />}</button>}</header>
    {children}
  </dialog>;
}
