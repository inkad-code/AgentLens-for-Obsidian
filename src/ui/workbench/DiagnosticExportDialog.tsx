import { useEffect, useRef, useState } from "react";
import type { AgentLensWorkbenchPort } from "../../workbench/ports";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { useHostDocument, useHostWindow } from "./HostDocument";

export function DiagnosticExportDialog({ service, onClose }: {
  service: AgentLensWorkbenchPort; onClose: () => void;
}) {
  const document = useHostDocument(), window = useHostWindow();
  const active = useRef(true), flight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const close = () => { active.current = false; onClose(); };
  async function exportFile() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(false);
    try {
      if (!service.exportLocalDiagnostics) throw new Error("Unavailable");
      const data = await service.exportLocalDiagnostics();
      if (!active.current) return;
      const url = window.URL.createObjectURL(new window.Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.body.createEl("a");
      try {
        link.href = url;
        link.download = `agentlens-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        link.hidden = true; document.body.append(link); link.click();
      } finally {
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      }
      close();
    } catch { if (active.current) setError(true); }
    finally { flight.current = false; if (active.current) setBusy(false); }
  }
  return <WorkbenchDialog compact title="Export local diagnostics?" onClose={close}>
    <p>Export diagnostics for the current account to a JSON file on this device. Nothing is uploaded.</p>
    {error && <p className="agentlens-inline-error" role="alert">Could not export diagnostics. Check that you’re signed in, then try again.</p>}
    <footer className="agentlens-dialog-actions">
      <button type="button" onClick={close}>Cancel</button>
      <button type="button" className="mod-cta" disabled={busy} onClick={() => void exportFile()}>{busy ? "Exporting…" : "Export JSON"}</button>
    </footer>
  </WorkbenchDialog>;
}
