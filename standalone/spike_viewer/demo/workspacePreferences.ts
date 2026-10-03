// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from "react";
import { createWorkspaceLayout, normalizeWorkspaceLayout, type WorkspaceLayout } from "../src/workspace/layoutModel";

type PanelDefinition = { id:string; title:string; defaultDock:"left"|"right"|"bottom" };
type PreferenceStorage = Pick<Storage,"getItem"|"setItem">;

export function readWorkspacePreference(storage:PreferenceStorage|undefined,key:string,panels:readonly PanelDefinition[]):WorkspaceLayout {
  try {
    const text=storage?.getItem(key);
    if(text && text.length<=32_768) return normalizeWorkspaceLayout(JSON.parse(text),panels);
  } catch { /* Browser privacy settings and old/corrupt values must not prevent opening the viewer. */ }
  return createWorkspaceLayout(panels);
}

export function writeWorkspacePreference(storage:PreferenceStorage,key:string,layout:WorkspaceLayout):boolean {
  try { storage.setItem(key,JSON.stringify(layout)); return true; } catch { return false; }
}

/** Persistence belongs to the host; the reusable workspace component stays storage-free. */
export function useWorkspacePreference(name:string,panels:readonly PanelDefinition[]) {
  const key=`spike-viewer:workspace:${name}:v1`;
  const [layout,setLayout]=useState(()=>{
    try {return readWorkspacePreference(window.localStorage,key,panels);} catch {return createWorkspaceLayout(panels);}
  });
  const [canSave,setCanSave]=useState(true);
  const update=useCallback((value:WorkspaceLayout)=>setLayout(value),[]);
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{
      try {setCanSave(writeWorkspacePreference(window.localStorage,key,layout));}catch{setCanSave(false);}
    },180);
    return ()=>window.clearTimeout(timeout);
  },[key,layout]);
  return {layout,onLayoutChange:update,canSave};
}
