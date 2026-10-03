// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { poseFromTransform, transformFromPose } from "../src/assembly/placement";
import type { AssemblyAsset, AssemblyInstance, AssemblyPick, Vec3 } from "../src/assembly/types";

export function AssemblyInspector({instance,asset,pick,onChange,onDuplicate,onRemove,onIsolate,isIsolated}:{
  instance?:AssemblyInstance;asset?:AssemblyAsset;pick?:AssemblyPick;
  onChange:(change:Partial<AssemblyInstance>)=>void;onDuplicate:()=>void;onRemove:()=>void;onIsolate:()=>void;isIsolated:boolean;
}) {
  const [pose,setPose]=useState({position:[0,0,0] as Vec3,rotationDeg:[0,0,0] as Vec3});
  useEffect(()=>{ if(instance)setPose(poseFromTransform(instance.transform)); },[instance]);
  if(!instance || !asset) return <section className="assembly-panel"><h2>Placement</h2><p>Select a board or mechanical part in the tree or viewport.</p></section>;
  return <section className="assembly-panel"><h2>Placement</h2><label>Name<input aria-label="Occurrence name" value={instance.name} maxLength={1000} onChange={event=>onChange({name:event.target.value||"Unnamed occurrence"})}/></label>
    <div className="assembly-checks"><label><input type="checkbox" checked={instance.visible} onChange={e=>onChange({visible:e.target.checked})}/>Visible</label><label><input type="checkbox" checked={instance.locked} onChange={e=>onChange({locked:e.target.checked})}/>Locked</label></div>
    <label>Opacity <input aria-label="Occurrence opacity" type="range" min="0" max="1" step="0.05" value={instance.opacity} onChange={e=>onChange({opacity:Number(e.target.value)})}/></label>
    <form onSubmit={e=>{e.preventDefault();onChange({transform:transformFromPose(pose.position,pose.rotationDeg)});}}>
      <fieldset disabled={instance.locked}><legend>World placement · mm / degrees</legend>
      {(["position","rotationDeg"] as const).map((kind)=><div className="xyz-fields" key={kind}>{["X","Y","Z"].map((axis,i)=><label key={axis}>{kind==="position" ? axis : `R${axis}`}<input aria-label={`${kind==="position" ? "Position" : "Rotation"} ${axis}`} type="number" required step="any" min={-1000000} max={1000000} value={Number(pose[kind][i].toFixed(5))} onChange={e=>setPose(old=>({...old,[kind]:old[kind].map((v,j)=>j===i?Number(e.target.value):v) as Vec3}))}/></label>)}</div>)}
      <button type="submit">Apply placement</button><button type="button" onClick={()=>onChange({transform:transformFromPose([0,0,0],[0,0,0])})}>Reset placement</button></fieldset>
    </form>
    <div className="assembly-actions"><button onClick={onDuplicate}>Duplicate</button><button onClick={onIsolate}>{isIsolated?"Show all":"Isolate"}</button><button disabled={instance.locked} onClick={onRemove}>Remove</button></div>
    <dl><dt>Asset</dt><dd>{asset.name}</dd><dt>Occurrence</dt><dd>{instance.id}</dd><dt>Source</dt><dd>{asset.source?.fileName??"Original demonstration"}</dd></dl>
    {asset.source?.notes?.map((note,i)=><p className="assembly-note" key={i}>{note}</p>)}
    {asset.kind==="board" && <p className="assembly-note">Source board geometry with proxy component bodies. Native footprint model assignments are retained as metadata.</p>}
    {pick?.instanceId===instance.id && <p className="assembly-note">Picked world point: {pick.worldPoint.map(v=>v.toFixed(3)).join(", ")} mm</p>}
  </section>;
}
