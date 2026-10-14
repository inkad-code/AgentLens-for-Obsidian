import type { CSSProperties } from "react";
import { actionStateAssets } from "./actionStateAssets";

export function ActionStateIcon({kind, size = 18}: {kind: keyof typeof actionStateAssets; size?: 18 | 20 | 32}) {
  const assets = actionStateAssets[kind];
  const style = Object.fromEntries(Object.entries(assets).map(([state,url])=>[`--action-icon-${state}`,`url(${url})`])) as CSSProperties;
  return <span className="agentlens-action-state-icon" style={{...style, width:size, height:size}} aria-hidden="true" />;
}
