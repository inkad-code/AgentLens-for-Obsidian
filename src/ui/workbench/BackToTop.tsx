import { useHostWindow } from "./HostDocument";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

const REVEAL_AFTER_PX = 320;

export function BackToTop() {
  const window = useHostWindow();
  const { t } = useI18n();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const targets = scrollTargets();

    const update = () => {
      setVisible(targets.some((target) => scrollTop(target, window) > REVEAL_AFTER_PX));
    };

    update();
    targets.forEach((target) => target.addEventListener("scroll", update, { passive: true }));
    return () => targets.forEach((target) => target.removeEventListener("scroll", update));
  }, []);

  function scrollTargets(): Array<HTMLElement | Window> {
    const container = anchorRef.current?.closest<HTMLElement>(".agentlens-activity, .agentlens-workbench__body");
    return container ? [container, window] : [window];
  }

  function returnToTop() {
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // Resolve from the mounted view, including restored scroll positions and pop-outs.
    for (const target of scrollTargets()) {
      if (scrollTop(target, window) > 0) target.scrollTo({ top: 0, behavior });
    }
  }

  return <span ref={anchorRef} className="agentlens-back-to-top-anchor">
    {visible && <button type="button" className="agentlens-back-to-top" aria-label={t("backToTop")} onClick={returnToTop}>
      <span aria-hidden="true">↑</span>
      <span>{t("backToTop")}</span>
    </button>}
  </span>;
}

function scrollTop(target: HTMLElement | Window, window: Window): number {
  return target === window ? window.scrollY : (target as HTMLElement).scrollTop;
}
