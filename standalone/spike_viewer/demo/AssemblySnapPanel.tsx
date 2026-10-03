// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { assetAnchors, snapPlacement, worldAnchor } from "../src/assembly/placement";
import type { AssemblyAnchor, AssemblyDocument, AssemblyPick } from "../src/assembly/types";

export function AssemblySnapPanel({document,selectedId,pick,onApply,onAnchors}:{document:AssemblyDocument;selectedId?:string;pick?:AssemblyPick;onApply:(matrix:number[])=>void;onAnchors:(anchors:AssemblyAnchor[])=>void}) {
  const [targetId,setTargetId]=useState("");const [sourceKey,setSourceKey]=useState("");const [targetKey,setTargetKey]=useState("");
  const [sourcePick,setSourcePick]=useState<AssemblyAnchor>();const [targetPick,setTargetPick]=useState<AssemblyAnchor>();
  const [align,setAlign]=useState(false);const [gap,setGap]=useState(0);const [error,setError]=useState("");
  const moving=document.instances.find(v=>v.id===selectedId),target=document.instances.find(v=>v.id===targetId);
  const choices=useMemo(()=>{ const all=new Map<string,AssemblyAnchor[]>();for(const v of document.instances) {const a=document.assets.find(a=>a.id===v.assetId);if(a)all.set(v.id,assetAnchors(a,v.id));}return all; },[document.assets,document.instances]);
  const sources=moving ? [...(choices.get(moving.id)??[]),...(sourcePick?.instanceId===moving.id?[sourcePick]:[])] : [];
  const targets=target ? [...(choices.get(target.id)??[]),...(targetPick?.instanceId===target.id?[targetPick]:[])] : [];
  const source=sources.find(v=>v.id===sourceKey)??sources[0],destination=targets.find(v=>v.id===targetKey)??targets[0];
  useEffect(()=>{onAnchors([source,destination].filter((v):v is AssemblyAnchor=>Boolean(v)));},[source?.id,destination?.id,sourcePick,targetPick,onAnchors]);
  useEffect(()=>{setSourcePick(undefined);setError("");},[selectedId]);
  const fromPick=(which:"source"|"target")=> {if(!pick)return;const anchor:AssemblyAnchor={id:`picked:${which}:${pick.instanceId}`,instanceId:pick.instanceId,label:pick.kind==="vertex"?"Picked mesh vertex":"Picked surface point",kind:pick.kind==="vertex"?"vertex":"face",point:pick.localPoint,normal:pick.localNormal};if(which==="source"){setSourcePick(anchor);setSourceKey(anchor.id);}else{setTargetPick(anchor);setTargetKey(anchor.id);}};
  let separation:number|undefined;
  if(source&&destination&&moving&&target){const a=worldAnchor(source,moving).point,b=worldAnchor(destination,target).point;separation=Math.hypot(...a.map((v,i)=>v-b[i]));}
  return <section className="assembly-panel"><h2>Snap &amp; align</h2><p className="assembly-note">Choose a moving occurrence, then a fixed target. Hole centres and outline midpoints are exact source points. MCAD face samples use the display mesh.</p>
    <label>Moving anchor<select aria-label="Moving anchor" value={source?.id??""} onChange={e=>setSourceKey(e.target.value)}>{sources.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
    <button disabled={!pick || pick.instanceId!==moving?.id} onClick={()=>fromPick("source")}>Use picked moving point</button>
    <label>Target occurrence<select aria-label="Target occurrence" value={targetId} onChange={e=>{setTargetId(e.target.value);setTargetPick(undefined);setTargetKey("");}}><option value="">Choose target…</option>{document.instances.filter(v=>v.id!==selectedId && v.visible).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label>Target anchor<select aria-label="Target anchor" value={destination?.id??""} onChange={e=>setTargetKey(e.target.value)}>{targets.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
    <button disabled={!pick || pick.instanceId!==target?.id} onClick={()=>fromPick("target")}>Use picked target point</button>
    <label className="inline-check"><input type="checkbox" checked={align} onChange={e=>setAlign(e.target.checked)}/>Align opposing normals</label>
    <label>Gap along target normal (mm)<input aria-label="Snap gap" type="number" step="any" value={gap} onChange={e=>setGap(Number(e.target.value))}/></label>
    <button disabled={!moving || !target || !source || !destination || moving.locked} onClick={()=>{try {onApply(snapPlacement(moving!,source!,target!,destination!,{alignNormals:align,gapMm:gap}));setError("");}catch(error){setError(String((error as Error).message));}}}>Snap selected occurrence</button>
    {separation!==undefined && <output className="assembly-note">Anchor distance: {separation.toFixed(3)} mm</output>}
    {error&&<p role="alert">{error}</p>}<p className="assembly-note">A snap changes placement once. No persistent mate or collision solver is applied. Use Ctrl/⌘-click to sample another part while keeping the moving selection.</p>
  </section>;
}
