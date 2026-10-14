import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type RemoteImageLoader = (url: string) => Promise<Blob>;
export const RemoteImageContext = createContext<RemoteImageLoader | undefined>(undefined);

/** Retry a blocked CDN image through the host transport; release bytes on unmount. */
export function RemoteImage({ url, className, alt, placeholder = alt }: { url: string; className: string; alt: string; placeholder?: ReactNode }) {
  const load = useContext(RemoteImageContext);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [fallback, setFallback] = useState<{ url: string; objectUrl: string }>();
  useEffect(() => {
    if (failedUrl !== url || !load) return;
    let active = true;
    let objectUrl: string | undefined;
    void load(url).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setFallback({ url, objectUrl });
    }).catch(() => { /* Keep an accessible placeholder for unavailable sources. */ });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [failedUrl, url, load]);
  const source = fallback?.url === url ? fallback.objectUrl : url;
  if (failedUrl === source) return <span className={className === "agentlens-media-thumb" && typeof placeholder !== "string" ? `${className} agentlens-media-placeholder` : className} aria-label="Thumbnail unavailable">{placeholder}</span>;
  return <img className={className} src={source} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(source)} />;
}
