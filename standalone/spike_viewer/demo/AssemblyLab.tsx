// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { AssemblyViewer } from "../src/assembly/AssemblyViewer";
import { replaceInstance, transformFromPose } from "../src/assembly/placement";
import { validateAssemblyDocument } from "../src/assembly/validation";
import type { AssemblyAnchor, AssemblyAsset, AssemblyDocument, AssemblyInstance, AssemblyPick, AssemblySection, AssemblyViewCommand } from "../src/assembly/types";
import type { VirtualPick } from "../src/overlays/types";
import { importAssemblyFile } from "../adapters/importFiles";
import { parseAssemblyProject, serializeAssemblyProject } from "../adapters/projectFile";
import { assemblyFixture } from "./assemblyFixture";
import { AssemblyInspector } from "./AssemblyInspector";
import { AssemblySnapPanel } from "./AssemblySnapPanel";
import "./style.css";
import "../src/style.css";
import "./assemblyLab.css";
import "./workspaceLab.css";
import { DockWorkspace } from "../src/workspace/DockWorkspace";
import { useWorkspacePreference } from "./workspacePreferences";

const PANEL_DEFINITIONS = [
  {id:"assembly",title:"Assembly",defaultDock:"left"},
  {id:"placement",title:"Placement",defaultDock:"right"},
  {id:"snap",title:"Snap & align",defaultDock:"right"},
  {id:"view",title:"View & results",defaultDock:"right"},
  {id:"help",title:"Help",defaultDock:"right"},
] as const;

type History = {current:AssemblyDocument;past:AssemblyDocument[];future:AssemblyDocument[]};
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function AssemblyLab() {
  const workspace=useWorkspacePreference("assembly",PANEL_DEFINITIONS);
  const [history,setHistory]=useState<History>(()=>({current:assemblyFixture(),past:[],future:[]}));
  const doc=history.current;
  const historyRef=useRef(history);historyRef.current=history;
  const [preview,setPreview]=useState<{id:string;matrix:number[]}>();
  const [selectedId,setSelectedId]=useState<string|undefined>("controller-b");const [pick,setPick]=useState<AssemblyPick>();
  const [virtualPick,setVirtualPick]=useState<(VirtualPick&{instanceId:string})>();
  const [mode,setMode]=useState<"2D"|"3D">("3D");const [tool,setTool]=useState<"select"|"translate"|"rotate">("select");
  const [pickMode,setPickMode]=useState<"surface"|"vertex">("surface");
  const [space,setSpace]=useState<"world"|"local">("world");const [gridSnap,setGridSnap]=useState(1);const [angleSnap,setAngleSnap]=useState(15);
  const [isolated,setIsolated]=useState<string>();const [anchors,setAnchors]=useState<AssemblyAnchor[]>([]);
  const [command,setCommand]=useState<AssemblyViewCommand>({id:0,action:"fit"});
  const [section,setSection]=useState<AssemblySection>({enabled:false,axis:"z",offsetMm:10});
  const [edges,setEdges]=useState(true);const [grid,setGrid]=useState(true);const [showVirtual,setShowVirtual]=useState(false);const [frame,setFrame]=useState(0);
  const [error,setError]=useState("");const [status,setStatus]=useState("Example assembly · two board occurrences and one mounting plate");
  const [busy,setBusy]=useState(false);const controller=useRef<AbortController>();
  const [meshUnit,setMeshUnit]=useState<"mm"|"cm"|"m"|"in">("mm");
  const [editor,setEditor]=useState<"open"|"save"|undefined>();const [json,setJson]=useState("");const returnFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const commit=useCallback((change:AssemblyDocument|((old:AssemblyDocument)=>AssemblyDocument))=>{
    const old=historyRef.current;
    const next=typeof change==="function"?change(old.current):change;validateAssemblyDocument(next);
    const updated={current:next,past:[...old.past,old.current].slice(-20),future:[]};
    historyRef.current=updated;setPreview(undefined);setHistory(updated);
  },[]);
  const changeInstance=(change:Partial<AssemblyInstance>)=>{if(!selectedId)return;try{commit(old=>replaceInstance(old,selectedId,change));setError("");}catch(e){setError(message(e));}};
  const undo=()=>{setPreview(undefined);setHistory(old=>old.past.length?{current:old.past[old.past.length-1],past:old.past.slice(0,-1),future:[old.current,...old.future]}:old);};
  const redo=()=>{setPreview(undefined);setHistory(old=>old.future.length?{current:old.future[0],past:[...old.past,old.current],future:old.future.slice(1)}:old);};
  const view=(action:AssemblyViewCommand["action"])=>setCommand(old=>({id:old.id+1,action}));
  const selected=doc.instances.find(v=>v.id===selectedId),asset=doc.assets.find(a=>a.id===selected?.assetId);
  const shownDoc=preview ? replaceInstance(doc,preview.id,{transform:preview.matrix}) : doc;
  const select=(id:string|null)=>{setSelectedId(id??undefined);setPick(undefined);setVirtualPick(undefined);};
  const importFiles=async(files:File[])=> {
    if(!files.length || busy)return;
    const abort=new AbortController();controller.current=abort;setBusy(true);setError("");
    try {
      const assets:AssemblyAsset[]=[];
      for(let i=0;i<files.length;i++) {setStatus(`Importing ${i+1}/${files.length}: ${files[i].name}`);assets.push(await importAssemblyFile(files[i],{signal:abort.signal,meshUnit}));}
      if(abort.signal.aborted)throw new Error("Import cancelled.");
      const added:AssemblyInstance[]=assets.map((a,i)=>({id:crypto.randomUUID(),assetId:a.id,name:a.name,transform:transformFromPose([i*35,0,0],[0,0,0]),visible:true,locked:false,opacity:1}));
      // Admission precedes mutation; a failed batch leaves the assembly intact.
      const current=historyRef.current.current;
      const next=validateAssemblyDocument({...current,assets:[...current.assets,...assets],instances:[...current.instances,...added]});
      commit(next);setSelectedId(added[0].id);setStatus(`Imported ${assets.length} asset${assets.length===1?"":"s"}. Source placement retained; use Fit or move controls.`);view("fit");
    } catch(e) {setError(message(e));setStatus("Import did not change the assembly.");} finally {setBusy(false);controller.current=undefined;}
  };
  const importSamples=async()=> {
    setError("");
    try {const paths=["controller-board.kicad_pcb","sensor-board.kicad_pcb","spike-reflector-500x500x5.step"];
      const files:File[]=[];for(const name of paths){const response=await fetch(`./fixtures/${name}`);if(!response.ok)throw new Error(`Missing sample: ${name}`);files.push(new File([await response.blob()],name));}
      await importFiles(files);
    }catch(e){setError(message(e));}
  };
  const openEditor=(kind:"open"|"save")=>{try {returnFocus.current=document.activeElement as HTMLElement;setJson(kind==="save"?serializeAssemblyProject(doc):"");setEditor(kind);setError("");}catch(e){setError(message(e));}};
  const closeEditor=()=>{setEditor(undefined);returnFocus.current?.focus();};
  const save=()=>{const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="spike-assembly.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const panels = PANEL_DEFINITIONS.map(definition=>({...definition,content:
    definition.id==="assembly" ? <div className="assembly-tree">
      <section className="assembly-panel"><p className="assembly-note">{doc.instances.length} occurrences · {doc.assets.length} assets · mm</p>
        <div className="assembly-actions"><button disabled={busy} onClick={()=>openEditor("open")}>Open assembly</button><button disabled={busy} onClick={()=>openEditor("save")}>Save assembly</button></div>
        <label className="file-import">Add boards / MCAD<input aria-label="Import board or MCAD files" type="file" multiple disabled={busy} accept=".kicad_pcb,.step,.stp,.iges,.igs,.stl,.obj,.glb" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void importFiles(files);}}/></label>
        <label>STL / OBJ units<select aria-label="Mesh file units" value={meshUnit} onChange={e=>setMeshUnit(e.target.value as typeof meshUnit)}>{["mm","cm","m","in"].map(v=><option key={v}>{v}</option>)}</select></label>
        <p className="assembly-note">STEP/IGES units come from the file. GLB uses metres. Select several files to import together.</p>
        <button disabled={busy} onClick={()=>void importSamples()}>Import sample files</button>{busy&&<button onClick={()=>controller.current?.abort()}>Cancel import</button>}
      </section><ul aria-label="Assembly occurrences">{doc.instances.map(instance=><li key={instance.id}><button disabled={busy} aria-pressed={instance.id===selectedId} onClick={()=>select(instance.id)} title={instance.name}><span>{doc.assets.find(a=>a.id===instance.assetId)?.kind==="board"?"PCB":"CAD"}</span><b>{instance.name}</b><small>{instance.locked?"Locked":!instance.visible?"Hidden":""}</small></button></li>)}</ul>
    </div> : definition.id==="placement" ? <div className="assembly-properties">
      <AssemblyInspector instance={selected} asset={asset} pick={pick} isIsolated={isolated===selectedId} onChange={changeInstance}
        onDuplicate={()=>{if(!selected)return;const id=crypto.randomUUID();commit(old=>({...old,instances:[...old.instances,{...selected,id,name:`${selected.name} copy`,locked:false,transform:selected.transform.map((v,i)=>i===3?v+10:v)}]}));setSelectedId(id);}}
        onIsolate={()=>setIsolated(old=>old===selectedId?undefined:selectedId)}
        onRemove={()=>{if(!selected||selected.locked)return;commit(old=>{const instances=old.instances.filter(v=>v.id!==selectedId);return {...old,instances,assets:old.assets.filter(a=>instances.some(v=>v.assetId===a.id))};});setSelectedId(undefined);setIsolated(undefined);}}/>
    </div> : definition.id==="snap" ? <>
      <section className="assembly-panel assembly-settings"><h2>Movement controls</h2>
        <label>Axes<select aria-label="Transform axes" value={space} onChange={e=>setSpace(e.target.value as typeof space)}><option value="world">World</option><option value="local">Local</option></select></label>
        <div className="assembly-field-pair"><label>Move snap / mm<input aria-label="Translation snap mm" type="number" min="0" max="1000" step="any" value={gridSnap} onChange={e=>setGridSnap(Math.max(0,Math.min(1000,Number(e.target.value))))}/></label>
        <label>Angle / degrees<input aria-label="Rotation snap degrees" type="number" min="0" max="180" step="any" value={angleSnap} onChange={e=>setAngleSnap(Math.max(0,Math.min(180,Number(e.target.value))))}/></label></div>
        <label>Pick mode<select aria-label="Pick snap mode" value={pickMode} onChange={e=>setPickMode(e.target.value as typeof pickMode)}><option value="surface">Surface</option><option value="vertex">Mesh vertex</option></select></label>
      </section>
      <AssemblySnapPanel document={doc} selectedId={selectedId} pick={pick} onApply={matrix=>changeInstance({transform:matrix})} onAnchors={setAnchors}/>
    </> : definition.id==="view" ? <section className="assembly-panel assembly-settings">
      <h2>Camera &amp; display</h2><div className="assembly-actions"><button onClick={()=>view("fit")}>Fit all</button><button disabled={!selected} onClick={()=>view("fit-selection")}>Fit selected</button>{(["top","front","right","iso"] as const).map(v=><button disabled={mode==="2D"&&v!=="top"} key={v} onClick={()=>view(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
      <div className="assembly-checks"><label><input type="checkbox" checked={edges} onChange={e=>setEdges(e.target.checked)}/>Edges</label><label><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>Grid</label><label><input type="checkbox" checked={showVirtual} onChange={e=>setShowVirtual(e.target.checked)}/>Virtual data</label></div>
      <label>Virtual data frame · {frame}<input aria-label="Assembly virtual frame" type="range" min="0" max="2" value={frame} onChange={e=>setFrame(Number(e.target.value))}/></label>
      <h2>Section</h2><div className="assembly-checks"><label><input type="checkbox" checked={section.enabled} onChange={e=>setSection({...section,enabled:e.target.checked})}/>Section enabled</label><label><input type="checkbox" checked={section.flipped??false} onChange={e=>setSection({...section,flipped:e.target.checked})}/>Flip</label></div>
      <div className="assembly-field-pair"><label>Axis<select aria-label="Section axis" value={section.axis} onChange={e=>setSection({...section,axis:e.target.value as AssemblySection["axis"]})}>{["x","y","z"].map(v=><option key={v}>{v}</option>)}</select></label><label>Offset / mm<input aria-label="Section offset mm" type="number" step="any" value={section.offsetMm} onChange={e=>setSection({...section,offsetMm:Number(e.target.value)})}/></label></div>
      {virtualPick?<><h2>Virtual sample</h2><p>{virtualPick.instanceId}</p><pre>{JSON.stringify(virtualPick,null,2)}</pre></>:<p className="assembly-note">Enable virtual data and pick a sample to inspect its original values and source.</p>}
    </section> : <section className="assembly-panel"><h2>Navigation</h2><p className="assembly-note">Drag to orbit in 3D; right-drag to pan; scroll to zoom. Select Move or Rotate to manipulate an unlocked occurrence. In Snap &amp; align, use 0 for free movement. 2D uses the same assembly geometry in an orthographic top view.</p>
      <h2>Arrange your workspace</h2><p className="assembly-note">Drag panel titles to float or dock them. Use panel placement menus as a keyboard alternative. Resize panels at their edges, or use the dock splitters. Your layout is saved in this browser; Reset layout restores the starting arrangement.</p><p className="assembly-note">Small screens show one panel at a time. Close a drawer or use Focus viewport to give the board more room. Resizing the window preserves your desktop arrangement.</p>
      <h2>Data &amp; geometry</h2><p className="assembly-note">Demo data is synthetic. Imported CAD is tessellated for display. Assembly placement does not imply electrical connectivity or validate clearances.</p><a className="assembly-link" href="?lab=virtual" target="_blank" rel="noreferrer">Open virtual data lab ↗</a>
    </section>
  }));
  return <main className="assembly-lab docked-lab">
    <header className="lab-header"><div className="brand-mark">S<span>V</span></div><div><h1>SPIKE <span>Assembly studio</span></h1><p>Boards, mechanical geometry &amp; virtual data</p></div><span className="version">0.3 / PREVIEW</span></header>
    <div className="assembly-toolbar essential-toolbar" role="toolbar" aria-label="Assembly controls"><div className="mode-switch">{(["3D","2D"] as const).map(v=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{v}</button>)}</div>
      {(["select","translate","rotate"] as const).map(v=><button key={v} aria-pressed={tool===v} onClick={()=>setTool(v)}>{v==="translate"?"Move":v==="rotate"?"Rotate":"Select"}</button>)}
      <button onClick={()=>view("fit")}>Fit all</button><div className="history-controls"><button disabled={!history.past.length||busy} onClick={undo}>Undo</button><button disabled={!history.future.length||busy} onClick={redo}>Redo</button></div>
      <span className="selected-occurrence" title={selected?.name}>{selected?.name??"No selection"}</span>
    </div>
    <div className="dock-workspace-slot"><DockWorkspace panels={panels} layout={workspace.layout} onLayoutChange={workspace.onLayoutChange}>
      <section className="assembly-centre" aria-label="Assembly viewport"><div className="assembly-canvas"><AssemblyViewer document={shownDoc} mode={mode} selectedId={selectedId} onSelect={id=>{if(!busy)select(id);}} onPick={setPick} pickMode={pickMode} onVirtualPick={setVirtualPick} tool={busy?"select":tool} space={space} translationSnapMm={gridSnap} rotationSnapDeg={angleSnap} command={command} section={section} showEdges={edges} showGrid={grid} showVirtual={showVirtual} frameIndex={frame} isolatedId={isolated} anchors={anchors} onTransform={(id,matrix,done)=>{if(done){setPreview(undefined);try{commit(old=>replaceInstance(old,id,{transform:matrix}));}catch(e){setError(message(e));}}else setPreview({id,matrix});}}/></div></section>
    </DockWorkspace></div>
    <div className="assembly-status" role="status">{status}{!workspace.canSave&&" · Layout preferences cannot be saved in this browser."}</div>{error&&!editor&&<p className="assembly-error" role="alert">{error}</p>}
    {editor&&<div className="editor-backdrop"><section className="data-editor" role="dialog" aria-modal="true" aria-labelledby="assembly-editor-title" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();closeEditor();}if(e.key==="Tab"){const els=Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button,input,textarea"));if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els[els.length-1]?.focus();}else if(!e.shiftKey&&document.activeElement===els[els.length-1]){e.preventDefault();els[0]?.focus();}}}}><header><h2 id="assembly-editor-title">{editor==="save"?"Save assembly":"Open assembly"}</h2><button autoFocus onClick={closeEditor}>Close</button></header><p>Portable JSON includes geometry, source metadata, placements, visibility, locks and board-bound virtual layers. Original STEP boundary representations are not embedded.</p><textarea aria-label="Assembly JSON" readOnly={editor==="save"} value={json} onChange={e=>setJson(e.target.value)} spellCheck={false}/>{error&&<p role="alert" className="import-error">{error}</p>}<footer>{editor==="save"?<button onClick={save}>Download assembly JSON</button>:<><label>Read assembly file<input type="file" accept=".json" onChange={async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>64*1024*1024)throw new Error("Assembly exceeds 64 MiB.");setJson(await file.text());setError("");}catch(e){setError(message(e));}}}/></label><button onClick={()=>{try{const next=parseAssemblyProject(json);commit(next);setSelectedId(next.instances[0]?.id);setIsolated(undefined);setStatus(`Opened ${next.name}`);setError("");setPick(undefined);closeEditor();view("fit");}catch(e){setError(message(e));}}}>Open project</button></>}</footer></section></div>}
  </main>;
}
