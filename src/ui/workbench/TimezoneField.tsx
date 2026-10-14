import { useHostDocument, useHostWindow } from "./HostDocument";
import { useEffect, useId, useMemo, useState } from "react";
import { inputChevron } from "./inputAssets";

export function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', {timeZone:value}).format(); return Boolean(value.trim()); } catch { return false; }
}
const regionalNames = ['Shanghai','Hefei','Guangzhou','Shenzhen','Changsha','Beijing','Henan'].map(city => ({city,zone:'Asia/Shanghai'}));
function timezoneChoices() {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York'];
  return [...regionalNames,{city:'UTC',zone:'UTC'},...supported.filter(zone => zone !== 'Asia/Shanghai').map(zone => ({city:zone.split('/').at(-1)!.replaceAll('_',' '),zone}))];
}
function offset(zone: string) {
  return new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'shortOffset'}).formatToParts().find(part => part.type==='timeZoneName')?.value ?? zone;
}

export function TimezoneField({value,onChange,chevron = inputChevron}: {value:string;onChange:(zone:string)=>void;chevron?:string}) {
  const document = useHostDocument();
  const window = useHostWindow();
  const id = useId();
  const [open,setOpen] = useState(false);
  const [active,setActive] = useState(-1);
  const [searching,setSearching] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target !== document.getElementById(id)) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('agentlens-escape', dismiss as EventListener, true);
    return () => { window.removeEventListener('keydown', dismiss, true); window.removeEventListener('agentlens-escape', dismiss as EventListener, true); };
  }, [open, id]);
  const choices = useMemo(timezoneChoices,[]);
  const filtered = choices.filter(item => !searching || `${item.city} ${item.zone}`.toLowerCase().includes(value.toLowerCase().trim()));
  function choose(index: number) {const item = filtered[index];if (item) {onChange(item.zone);setOpen(false);setSearching(false);setActive(-1);}}
  return <div className="agentlens-timezone-field" onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}}>
    <label htmlFor={id}>TIMEZONE</label>
    <div className="agentlens-timezone-input" data-editing={open && searching}><input id={id} role="combobox" aria-label="Timezone" aria-invalid={!open && !validTimezone(value)} aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && active>=0 ? `${id}-${active}` : undefined} autoComplete="off" value={value} onFocus={() => {setOpen(true);setActive(-1);}} onChange={event => {onChange(event.currentTarget.value);setSearching(true);setActive(-1);setOpen(true);}} onKeyDown={event => {
      if (event.key==='ArrowDown' || event.key==='ArrowUp') {event.preventDefault();setOpen(true);setActive(previous => {const next=Math.max(0,Math.min(filtered.length-1,previous+(event.key==='ArrowDown'?1:-1))); window.requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.scrollIntoView({block:'nearest'}));return next;});}
      if (event.key==='Enter' && open) {event.preventDefault();choose(active>=0?active:0);}
      if (event.key==='Escape' && open) {event.preventDefault();event.stopPropagation();setOpen(false);}
    }} /><button type="button" aria-label="Show timezones" tabIndex={-1} onMouseDown={event=>event.preventDefault()} onClick={()=>{document.getElementById(id)?.focus();setOpen(!open);setSearching(false);}}><img src={chevron} width="14" height="14" alt="" /></button></div>
    {open && <TimezoneOptions id={id} items={filtered} active={active} query={searching ? value : ""} onChoose={choose} />}
  </div>;
}


export interface TimezoneChoice {city:string;zone:string}

function HighlightedCity({city,query}: {city:string;query:string}) {
  const needle=query.trim();
  const index=needle ? city.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if(index<0)return <>{city}</>;
  return <>{city.slice(0,index)}<mark>{city.slice(index,index+needle.length)}</mark>{city.slice(index+needle.length)}</>;
}

export function TimezoneOptions({id,items,active,query="",onChoose}: {
  id:string;items:readonly TimezoneChoice[];active:number;query?:string;onChoose:(index:number)=>void;
}) {
 return <div className="agentlens-timezone-options" role="listbox" id={`${id}-options`} aria-label="Timezones">
  {items.map((item,index)=><div key={`${item.city}-${item.zone}`} id={`${id}-${index}`} role="option" aria-selected={active===index} className={active===index?'is-active':undefined} onMouseDown={event=>event.preventDefault()} onClick={()=>onChoose(index)}>
   <span><HighlightedCity city={item.city} query={query} /></span><small>{item.zone.replaceAll('/',' / ')} · {offset(item.zone)}</small>
  </div>)}
  {!items.length && <p>No matching timezone. Search a city or IANA timezone.</p>}
 </div>;
}
