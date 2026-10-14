import { singleControlAssets } from "./singleControlAssets";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { designAssets } from "./designAssets";
import { folderAssets } from "./folderAssets";

export interface VaultFolderInfo {
  paths: readonly string[];
  name: string;
  counts: Readonly<Record<string, number>>;
  recent?: string | undefined;
  onSelect?: ((path: string) => void) | undefined;
  refresh?: (() => void) | undefined;
}
export const VaultFoldersContext = createContext<VaultFolderInfo>({paths: [], name: "Current Vault", counts: {}});

/** Folder paths are the identity; display names may repeat in separate branches. */
export function FolderTree({ value, onChange }: {value: string; onChange: (path: string) => void}) {
  const vault = useContext(VaultFoldersContext);
  const tree = useRef<HTMLDivElement>(null);
  const paths = useMemo(() => {
    const result = new Set<string>();
    for (const path of [...vault.paths, value].filter(Boolean)) {
      const parts = path.split('/').filter(Boolean);
      parts.forEach((_, index) => result.add(parts.slice(0, index + 1).join('/')));
    }
    // Vault load order is not tree order. Compare each segment so every
    // descendant stays next to its parent, even with similarly named siblings.
    return [...result].sort((left, right) => {
      const a = left.split('/'), b = right.split('/');
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        const order = a[i]!.localeCompare(b[i]!);
        if (order) return order;
      }
      return a.length - b.length;
    });
  }, [vault.paths, value]);
  const [expanded, setExpanded] = useState(() => new Set(paths.filter(path => !path.includes('/') && paths.some(child => child.startsWith(`${path}/`))).concat(value.split('/').map((_, i, parts) => parts.slice(0, i).join('/')).filter(Boolean))));
  useEffect(() => {
    setExpanded(previous => new Set([...previous, ...value.split('/').map((_, i, parts) => parts.slice(0, i).join('/')).filter(Boolean)]));
  }, [value]);
  const visible = paths.filter(path => path.split('/').every((_, index, parts) => index === 0 || expanded.has(parts.slice(0,index).join('/'))));
  function toggle(path: string, open = !expanded.has(path)) {
    setExpanded(previous => { const next = new Set(previous); if (open) next.add(path); else next.delete(path); return next; });
  }
  return <div ref={tree} className="agentlens-folder-tree" role="tree" aria-label="Vault folders" onKeyDown={event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!row) return;
    const path = row.dataset.path!;
    const rows = [...tree.current!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = rows.indexOf(row);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0,Math.min(rows.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
      rows[next]?.focus();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault(); if (paths.some(child => child.startsWith(`${path}/`))) { if (!expanded.has(path)) toggle(path,true); else rows[index+1]?.focus(); }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); if (expanded.has(path)) toggle(path,false); else rows.find(item => item.dataset.path === path.split('/').slice(0,-1).join('/'))?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChange(path); }
  }}>
    {visible.map((path,index) => {
      const depth = path.split('/').length - 1;
      const children = paths.some(child => child.startsWith(`${path}/`));
      const count = vault.counts[path];
      const expandable = children;
      return <div key={path} role="treeitem" data-path={path} aria-label={path} aria-level={depth+1} aria-selected={value===path} aria-expanded={expandable ? expanded.has(path) : undefined} tabIndex={value === path || !visible.includes(value) && index===0 ? 0 : -1} className="agentlens-folder-tree-row" style={{paddingInlineStart: `${14 + depth * 28}px`}} onClick={() => onChange(path)}>
        {expandable ? <button type="button" tabIndex={-1} className="agentlens-folder-expand" aria-label={`${expanded.has(path) ? 'Collapse' : 'Expand'} ${path}`} onClick={event => {event.stopPropagation();toggle(path);}}><img src={expanded.has(path) ? folderAssets.imgChevronDown1 : folderAssets.imgChevronRight} alt="" /></button> : <span className="agentlens-folder-chevron-space" aria-hidden="true" />}
        <img className="agentlens-folder-tree-icon" src={value===path ? folderAssets.imgIconFolder1 : folderAssets.imgIconFolder} alt="" />
        <span className="agentlens-folder-tree-name">{path.split('/').at(-1)}{count !== undefined && <small> ({count})</small>}</span>
        {vault.recent===path && <span className="agentlens-folder-recent">RECENTLY SELECTED</span>}
        {value===path && <img className="agentlens-folder-check" src={folderAssets.imgSelectedCheck} alt="" />}
      </div>;
    })}
    {!visible.length && <p>No folders yet. Enter a new path below.</p>}
  </div>;
}

export function VaultFolderPicker({value,onChange}: {value:string;onChange:(path:string)=>void}) {
  const vault = useContext(VaultFoldersContext);
  useEffect(() => { vault.refresh?.(); }, [vault.refresh]);
  return <div className="agentlens-folder-picker-fields">
    <label>Vault<select aria-label="Vault" style={{backgroundImage: `url(${folderAssets.imgChevronDown})`}}><option>{vault.name}</option></select></label>
    <div><span className="agentlens-folder-section-label">Folder</span><FolderTree value={value} onChange={onChange} /></div>
  </div>;
}

export function FolderField({ label, value, onChange, compact = false }: { compact?: boolean; label: string; value: string; onChange: (path: string) => void }) {
  const vault = useContext(VaultFoldersContext);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const id = useId();
  const pathInput = <input id={id} aria-label={label} value={value} onChange={event => onChange(event.currentTarget.value)} />;
  return <div className={`agentlens-folder-field${compact ? " is-compact" : ""}`}>
    <label htmlFor={id}>{compact ? "Saving to" : label}</label>
    <div>{compact ? <span className="agentlens-folder-input-size"><span aria-hidden="true">{value || " "}</span>{pathInput}</span> : pathInput}<button type="button" aria-label={`Browse ${label.toLowerCase()}`} onClick={() => {setSelected(value);setOpen(true);}}><img src={compact ? singleControlAssets.edit : designAssets.imgIconFolder} width={compact ? 12 : 18} height={compact ? 12 : 18} alt="" /></button></div>
    {open && <WorkbenchDialog textClose title="Select Folder" className="agentlens-folder-dialog" onClose={() => setOpen(false)}>
      <p>Please choose an appropriate folder to store your assets.</p>
      <VaultFolderPicker value={selected} onChange={setSelected} />
      <label className="agentlens-folder-path">SAVE TO<input aria-label="Selected folder path" value={selected} onChange={event => setSelected(event.currentTarget.value)} /></label>
      <footer className="agentlens-dialog-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="mod-cta" disabled={!selected.trim()} onClick={() => {onChange(selected.trim());vault.onSelect?.(selected.trim());setOpen(false);}}>Save</button></footer>
    </WorkbenchDialog>}
  </div>;
}
