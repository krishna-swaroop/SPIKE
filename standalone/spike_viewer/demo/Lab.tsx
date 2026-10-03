// SPDX-License-Identifier: Apache-2.0
import { useRef, useState } from "react";

import { BoardViewer, parseVirtualLayers, validateVirtualLayers, type VirtualLayer, type VirtualPick, type BoardObject } from "../src";
import { binding, board, demoLayers } from "./fixture";
import "./style.css";
import "./workspaceLab.css";
import { DockWorkspace } from "../src/workspace/DockWorkspace";
import { useWorkspacePreference } from "./workspacePreferences";

const PANEL_DEFINITIONS = [
  {id:"layers",title:"Virtual layers",defaultDock:"left"},
  {id:"inspect",title:"Inspect sample",defaultDock:"right"},
  {id:"view",title:"View & data",defaultDock:"right"},
] as const;

export default function Lab() {
  const workspace=useWorkspacePreference("virtual",PANEL_DEFINITIONS);
  const focusBeforeEditor=useRef<HTMLElement|null>(null);
  const [mode, setMode] = useState<"2D"|"3D">("3D");
  const [layers, setLayers] = useState(demoLayers);
  const [frame, setFrame] = useState(0);
  const [models, setModels] = useState(true);
  const [pick, setPick] = useState<VirtualPick | null>(null);
  const [selection, setSelection] = useState<BoardObject | null>(null);
  const [camera, setCamera] = useState("");
  const [editor, setEditor] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const maxFrame = Math.max(0, ...layers.map(layer => layer.frames.length-1));
  const editLayer = (id: string, update: Partial<VirtualLayer>) => { setLayers(current => current.map(layer => layer.id === id ? { ...layer, ...update } : layer)); setPick(null); };
  const command = (value: string) => setCamera(`${value}:${performance.now()}`);
  const importData = () => {
    try {
      const incoming = parseVirtualLayers(json, binding), ids = new Set(incoming.map(layer => layer.id));
      const combined = [...layers.filter(layer => !ids.has(layer.id)), ...incoming];
      validateVirtualLayers(combined, binding);
      setLayers(combined); setFrame(0); setPick(null); setError(""); setEditor(false); focusBeforeEditor.current?.focus();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not import data"); }
  };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(layers, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "viewer-virtual-layers.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openEditor=(isExport:boolean)=>{
    focusBeforeEditor.current=document.activeElement as HTMLElement;
    setExporting(isExport);setJson(JSON.stringify(isExport?layers:layers[0],null,2));setError("");setEditor(true);
  };
  const closeEditor=()=>{setEditor(false);focusBeforeEditor.current?.focus();};
  const content = {
    layers: <aside className="layer-panel"><div className="panel-heading"><h2>Virtual layers</h2><span>{layers.filter(layer => layer.visible).length} active</span></div>
        <p className="panel-note">Board coordinates in mm. Layers share the same positions in both views.</p>
        {layers.map(layer => <article className="layer-card" key={layer.id}><label className="layer-toggle"><input type="checkbox" aria-label={`Show ${layer.label}`} checked={layer.visible} onChange={event => editLayer(layer.id, { visible: event.target.checked })}/><b>{layer.label}</b></label>
          <div className="layer-meta"><span>{layer.quantity}{layer.unit ? ` / ${layer.unit}` : ""}</span><em>{layer.provenance.status}</em></div>
          <label className="opacity-label">Opacity <input type="range" min="0" max="1" step=".05" aria-label={`${layer.label} opacity`} value={layer.opacity} onChange={event => editLayer(layer.id, { opacity: Number(event.target.value) })}/><output>{Math.round(layer.opacity*100)}%</output></label>
          {layer.range && <div className="legend"><span>{layer.range[0]}</span><i/><span>{layer.range[1]} {layer.unit}</span></div>}
          <small>{layer.frames.length === 1 ? "Static" : `${layer.frames.length} frames`} / {[...new Set(layer.frames.flatMap(f => f.primitives.map(p => p.kind)))].join(", ")}</small>
        </article>)}
        <button className="reset-button" onClick={() => { setLayers(demoLayers()); setPick(null); setFrame(0); }}>Restore demonstration</button>
      </aside>,
    inspect: <aside className="inspector"><h2>Inspect a sample</h2>{pick ? <><div className="pick-title">{pick.quantity}</div><div className="pick-value">{pick.value === undefined ? pick.label ?? (pick.vector ? "Vector" : "Geometry") : pick.value.toPrecision(5)} <small>{pick.unit}</small></div><dl><dt>Layer</dt><dd>{pick.layerId}</dd><dt>Primitive</dt><dd>{pick.primitiveId}</dd><dt>Sample</dt><dd>{pick.sampleIndex}</dd><dt>Position / mm</dt><dd>{pick.positionMm.map(value => value.toFixed(3)).join(", ")}</dd>{pick.vector && <><dt>Vector</dt><dd>{pick.vector.join(", ")}</dd></>}<dt>Frame</dt><dd>{pick.frameId}</dd><dt>Status</dt><dd>{pick.provenance.status}</dd><dt>Source</dt><dd>{pick.provenance.source}</dd></dl></> : selection ? <><div className="pick-title">Board selection</div><dl><dt>Object</dt><dd>{selection.name}</dd><dt>Type</dt><dd>{selection.type}</dd><dt>Net</dt><dd>{selection.net ?? "Unassigned"}</dd></dl></> : <p>Click a colored sample, vector, mesh, route, or label to inspect its original data.</p>}
        <div className="interaction-help"><h3>{mode} navigation</h3><p>{mode === "3D" ? "Drag to orbit. Right-drag to pan. Scroll to zoom." : "Drag empty space to pan. Scroll to zoom."}</p><p>Scalar colors describe supplied samples. Surface shading is display interpolation.</p></div>
        <small className="binding-note">{binding.boardId}<br/>Revision {binding.revision}</small>
      </aside>,
    view: <section className="viewer-settings"><h2>Camera</h2>
      <div className="panel-buttons"><button onClick={()=>command("fit")}>Fit board</button><button onClick={()=>command("zoom-in")}>Zoom in</button><button onClick={()=>command("zoom-out")}>Zoom out</button></div>
      {mode==="3D"&&<label>Camera view<select aria-label="Camera view" defaultValue="orbit" onChange={event=>command(event.target.value)}><option value="orbit">Isometric</option><option value="view-top">Top</option><option value="view-bottom">Bottom</option><option value="view-front">Front</option><option value="view-right">Right</option></select></label>}
      <label><input type="checkbox" checked={models} onChange={event=>setModels(event.target.checked)}/>Component bodies</label>
      <h2>Virtual data</h2><div className="panel-buttons"><button className="primary" onClick={()=>openEditor(false)}>Import virtual data</button><button onClick={()=>openEditor(true)}>Export JSON</button></div>
      <p>Synthetic demonstration data. Original board fixture and virtual fields; no solver was run.</p><p>Drag panel titles to float or dock them, or use the placement menu. Layouts are saved in this browser. On small screens, choose a panel from the launcher and close it to return to the board.</p>
      <a className="assembly-link" href="./" target="_blank" rel="noreferrer">Open assembly studio ↗</a>
    </section>
  };
  const panels=PANEL_DEFINITIONS.map(panel=>({...panel,content:content[panel.id]}));
  return <main className="lab docked-lab">
    <header className="lab-header"><div className="brand-mark">S<span>V</span></div><div><h1>SPIKE Viewer <span>Lab</span></h1><p>Independent 2D + 3D engineering visualization</p></div><span className="version">0.3 / PREVIEW</span></header>
    <section className="lab-toolbar essential-toolbar" aria-label="Viewer controls"><div className="mode-switch">{(["2D","3D"] as const).map(value=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{value}</button>)}</div><button onClick={()=>command("fit")}>Fit board</button><button onClick={()=>command("zoom-in")}>Zoom in</button><button onClick={()=>command("zoom-out")}>Zoom out</button></section>
    <div className="dock-workspace-slot"><DockWorkspace panels={panels} layout={workspace.layout} onLayoutChange={workspace.onLayoutChange}>
      <div className="viewport-column"><div className="board-caption"><b>Viewer lab board</b><span>100 x 62 mm / 2 copper layers</span></div>
        <div className="viewer-slot"><BoardViewer board={board} binding={binding} mode={mode} layers={layers} frameIndex={frame} cameraCommand={camera} showModels={models}
          onVirtualPick={value => { setPick(value); setSelection(null); }} onSelect={value => { setSelection(value); setPick(null); }}/></div>
        <div className="timeline"><label htmlFor="frame">Frame <strong>{frame+1} / {maxFrame+1}</strong></label><input id="frame" type="range" min="0" max={maxFrame} step="1" value={frame} onChange={event => { setFrame(Number(event.target.value)); setPick(null); }}/><span>{layers.find(layer => layer.frames.length > 1)?.frames[frame]?.label ?? "Static data"}</span></div>
      </div>
    </DockWorkspace></div>
    {!workspace.canSave&&<p className="assembly-status" role="status">Layout preferences cannot be saved in this browser.</p>}
    {editor && <div className="editor-backdrop"><section className="data-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title" onKeyDown={event => {
      if (event.key === "Escape") closeEditor();
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,input,textarea"));
      const first = controls[0], last = controls[controls.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><header><h2 id="editor-title">{exporting ? "Export virtual data" : "Import virtual data"}</h2><button autoFocus onClick={closeEditor}>Close</button></header><p>{exporting ? "Copy the complete JSON below or download it. Source values and metadata are preserved." : "Paste one layer or an array. IDs replace matching layers."} Board: <code>{binding.boardId}</code>, revision: <code>{binding.revision}</code>.</p><textarea aria-label="Virtual layer JSON" readOnly={exporting} spellCheck={false} value={json} onChange={event => setJson(event.target.value)}/>{error && <p role="alert" className="import-error">{error}</p>}<footer>{exporting ? <button className="primary" onClick={exportData}>Download JSON</button> : <><label>Read JSON file <input type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 16*1024*1024) { setError("File exceeds 16 MiB"); return; } try { setJson(await file.text()); setError(""); } catch { setError("Could not read file"); } }}/></label><button className="primary" onClick={importData}>Apply virtual layers</button></>}</footer></section></div>}
  </main>;
}


