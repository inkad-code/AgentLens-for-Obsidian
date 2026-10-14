import { createContext, useContext } from "react";

/** Pop-out views belong to a different document and JavaScript DOM realm. */
export const HostDocumentContext = createContext<Document | null>(null);
export function useHostDocument(): Document {
  return useContext(HostDocumentContext) ?? document;
}
export function useHostWindow(): Window & typeof globalThis {
  return (useHostDocument().defaultView ?? window) as Window & typeof globalThis;
}
