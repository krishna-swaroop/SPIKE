// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import BoardViewport, { type ModelLoadStatus, type RenderTelemetry } from "../src/BoardViewport";
import { parseDesignSourceOffThread } from "../src/boardImport";
import type { ParsedBoard } from "../src/boardParser";
import type { VirtualBoardVisual } from "../src/harnessVisualization";
import ToolRestoreShelf from "../src/ToolRestoreShelf";
import "../src/styles.css";
import "../src/buttonStandard.css";

const noop = () => {}, empty = {}, noModels = [];
const root = "../.tmp/assembly-performance/";
function Preview() {
  const [board, setBoard] = useState<ParsedBoard | null>(null), [message, setMessage] = useState("Loading retained Sailor Hat source and KiCad models…");
  const [telemetry, setTelemetry] = useState<RenderTelemetry | null>(null), [status, setStatus] = useState<ModelLoadStatus | null>(null);
  const [x, setX] = useState(95), [angle, setAngle] = useState(0), [hidden, setHidden] = useState(false), [innerHidden, setInnerHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>("B"), [camera, setCamera] = useState("fit:0"), [running, setRunning] = useState(false);
  const [qualityHost, setQualityHost] = useState<HTMLSpanElement | null>(null);
  const [motionFrames, setMotionFrames] = useState(0);
  useEffect(() => { let disposed = false;
    void (async () => {
      try {
        const response = await fetch(root + "source.json"); if (!response.ok) throw new Error("Capture the retained fixture before opening this page.");
        const parsed = await parseDesignSourceOffThread("retained.spike-design.json", await response.text(), "spike-normalized");
        if (disposed) return;
        setBoard({ ...parsed, boardModelUrl: new URL(root + "board.glb", location.href).href,
          componentModelUrl: new URL(root + "components.glb", location.href).href, boardModelIncludesCopper: true });
        setMessage(`${parsed.components.length} components · ${parsed.layers.filter(layer => layer.endsWith('.Cu')).length} copper layers per board · two occurrences of the retained SH-RPi design`);
      } catch (cause) { if (!disposed) setMessage(String(cause)); }
    })(); return () => { disposed = true; };
  }, []);
  useEffect(() => { if (!running) return; let frame = 0, token = 0;
    const tick = () => { frame++; setX(95 + Math.sin(frame / 15) * 20); setAngle(frame / 4); setMotionFrames(frame);
      if (frame < 240) token = requestAnimationFrame(tick); else setRunning(false); };
    token = requestAnimationFrame(tick); return () => cancelAnimationFrame(token);
  }, [running]);
  const layers = useMemo(() => Object.fromEntries((board?.layers ?? []).map(name => [name,
    name.endsWith('.Cu') || name.endsWith('.Mask') || name.endsWith('.SilkS') || name === 'Edge.Cuts'])), [board]);
  const sources = useMemo(() => board ? { retained: board } : {}, [board]);
  const visibility = useMemo(() => ({ B: !hidden }), [hidden]);
  const boardLayers = useMemo(() => innerHidden ? { B: { ...layers, "In1.Cu": false, "In2.Cu": false } } : empty, [innerHidden, layers]);
  const boards = useMemo((): VirtualBoardVisual[] => {
    if (!board) return [];
    const cx = (board.bounds.minX + board.bounds.maxX) / 2, cy = (board.bounds.minY + board.bounds.maxY) / 2;
    const occurrence = (id: string, offset: number, rotation: number): VirtualBoardVisual => {
      const c = Math.cos(rotation * Math.PI / 180), s = Math.sin(rotation * Math.PI / 180);
      return { id, name: `Sailor Hat · ${id}`, designId: "retained", active: id === "A", widthMm: board.width, heightMm: board.height,
        thicknessMm: 1.6, localCenterMm: [cx, cy, 0], netIdsByName: Object.fromEntries(Object.entries(board.nets).map(([key, name]) => [name, `${id}:${key}`])),
        transform: [c, -s, 0, offset - c * cx + s * cy, s, c, 0, -s * cx - c * cy, 0, 0, 1, 0, 0, 0, 0, 1] };
    }; return [occurrence("A", 0, 0), occurrence("B", x, angle)];
  }, [board, x, angle]);
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#102028", color: "#dce9ee" }}>
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "6px 10px", borderBottom: "1px solid #3b505b" }}>
      <strong>Real assembly rendering verification</strong>
      <button onClick={() => setCamera(`fit:${Date.now()}`)}>Fit assembly</button>
      <button onClick={() => setCamera(`view-top:${Date.now()}`)}>Top view</button>
      <button onClick={() => setCamera(`view-isometric:${Date.now()}`)}>Isometric view</button>
      <button onClick={() => setCamera(`focus-selection:${Date.now()}`)}>Focus board</button>
      <button onClick={() => setCamera(`zoom-in:${Date.now()}`)}>Zoom in</button>
      <label>X mm <input type="number" style={{ width: 70 }} value={x.toFixed(2)} onChange={event => setX(Number(event.target.value))} /></label>
      <label>RZ deg <input type="number" style={{ width: 65 }} value={angle.toFixed(2)} onChange={event => setAngle(Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />Hide board B</label>
      <label><input type="checkbox" checked={innerHidden} onChange={event => setInnerHidden(event.target.checked)} />Hide inner copper on B</label>
      <button className="spike-control--primary" disabled={running || !board} onClick={() => setRunning(true)}>Exercise 240 placements</button>
    </header>
    <p style={{ margin: "5px 10px", fontSize: 12 }}>{message} · selected {selected ?? "none"} · motion frames {motionFrames}</p>
    <div className="board-canvas is-3d" style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {board && <BoardViewport board={board} viewMode="3D" visibleLayers={layers} layerOpacity={empty} layerSeparation={0} qualityTarget={qualityHost}
        showVias showModels showSmdModels showThtModels showNetNames navigationMode="orbit" navigationInertia cameraCommand={camera}
        assemblyModels={noModels} virtualBoards={boards} assemblyBoardDesigns={sources} assemblyBoardVisibility={visibility}
        assemblyLayerVisibility={boardLayers}
        selectedBoardInstanceId={selected} onBoardInstanceSelect={visual => setSelected(visual.id)}
        selectionFilter="all" selectedId={null} onSelect={noop} onCamera={noop} onModelStatus={setStatus} onTelemetry={setTelemetry} />}
    </div>
    <footer className="bottom-dock"><div className="dock-tabs" style={{ display: "flex", alignItems: "center", gap: 8 }}><ToolRestoreShelf /><span ref={setQualityHost} className="viewport-quality-host" /></div></footer>
    <output style={{ padding: "5px 10px", fontSize: 12 }}>Board {status?.board} · parts {status?.components} · {status?.error || "No model-load errors"}
      {telemetry && ` · ${telemetry.geometries} geometries · ${telemetry.textures} textures · ${telemetry.drawCalls} draws · ${telemetry.triangles.toLocaleString()} triangles · ${telemetry.fps.toFixed(1)} FPS · ${telemetry.frameTimeMs.toFixed(1)} ms/render`}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
