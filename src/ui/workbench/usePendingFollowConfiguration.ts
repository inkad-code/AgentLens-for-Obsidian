import {useEffect, useState} from "react";
import type {AutoFetchWorkbenchPort} from "../../workbench/ports";
export function usePendingFollowConfiguration(service?: AutoFetchWorkbenchPort, owner?: string) {
  const [pending,setPending]=useState<Set<string>>(new Set());
  useEffect(()=>{let active=true;setPending(new Set());const off=service?.subscribeFollowConfiguration?.(ids=>{if(active)setPending(new Set(ids));});return()=>{active=false;off?.();};},[service,owner]);
  return pending;
}
