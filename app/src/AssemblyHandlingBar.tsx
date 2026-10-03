// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Move3d, Rotate3d } from "./icons";
import type { AssemblyDesigns, AssemblyIr, AssemblyPlacement } from "./mcadAssembly";
import { boardOccurrences } from "./assemblyBoardManagerModel";
import { boardWorldPlacement, editBoardWorldPlacement, type PlacementAxis } from "./assemblyPlacementControls";
import "./AssemblyHandlingBar.css";

export type AssemblyMoveMode = "translate" | "rotate";
export type AssemblySnapMode = "hole" | "edge" | "off";

export interface AssemblyHandlingBarProps {
  assembly: AssemblyIr;
  designs: AssemblyDesigns;
  selectedBoardId: string | null;
  visibility: Readonly<Record<string, boolean>>;
  explodedDistanceMm: number;
  onSelectBoard: (boardId: string) => void;
  onVisibility: (boardId: string, visible: boolean) => void;
  onPlacement: (boardId: string, transform: number[]) => void;
  onMoveMode: (mode: AssemblyMoveMode) => void;
  onExplodedDistance: (distanceMm: number) => void;
  onSnapMode: (mode: AssemblySnapMode) => void;
  snapMode?: AssemblySnapMode;
  snapGapMm?: number;
  onSnapGapChange?: (gapMm: number) => void;
  snapSourceLabel?: string;
}

const placementFields: Array<{ axis: PlacementAxis; label: string; unit: string }> = [
  { axis: "xMm", label: "X", unit: "mm" }, { axis: "yMm", label: "Y", unit: "mm" }, { axis: "zMm", label: "Z", unit: "mm" },
  { axis: "rxDeg", label: "RX", unit: "deg" }, { axis: "ryDeg", label: "RY", unit: "deg" }, { axis: "rzDeg", label: "RZ", unit: "deg" },
];

function CommitNumberInput({ value, label, min, onCommit }: { value: number; label: string; min?: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const finish = () => {
    editing.current = false;
    if (cancelled.current) { cancelled.current = false; setDraft(String(value)); return; }
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next) && (min === undefined || next >= min)) onCommit(next);
    else setDraft(String(value));
  };
  return <input type="number" step="any" min={min} aria-label={label} value={draft}
    onFocus={() => { editing.current = true; }} onChange={event => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={event => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { cancelled.current = true; setDraft(String(value)); event.currentTarget.blur(); }
    }}/>
}

export default function AssemblyHandlingBar(props: AssemblyHandlingBarProps) {
  const boards = useMemo(() => boardOccurrences(props.assembly, props.designs), [props.assembly, props.designs]);
  const selected = boards.find(board => board.id === props.selectedBoardId) ?? null;
  let placement: AssemblyPlacement | null = null;
  let placementError = "";
  if (selected) {
    try { placement = boardWorldPlacement(props.assembly, selected.id); }
    catch (error) { placementError = error instanceof Error ? error.message : "Board placement is unavailable."; }
  }
  const applyField = (axis: PlacementAxis, value: number) => {
    if (!selected) return;
    try { props.onPlacement(selected.id, editBoardWorldPlacement(props.assembly, selected.id, { [axis]: value })); }
    catch { /* The visible placement alert continues to describe an invalid source frame. */ }
  };
  return <section className="assembly-handling-bar" aria-label="Assembly board handling">
    <div className="assembly-handling-board-list" role="list" aria-label="Board occurrences">
      {boards.map(board => {
        const visible = props.visibility[board.id] !== false;
        return <div className={board.id === selected?.id ? "selected" : ""} role="listitem" key={board.id}>
          <button className="assembly-board-select" type="button" aria-pressed={board.id === selected?.id} title={`${board.name} (${board.id})`} onClick={() => props.onSelectBoard(board.id)}>
            <span>{board.name}</span><small>{board.id}</small>
          </button>
          <button className="assembly-board-visibility" type="button" aria-label={`${visible ? "Hide" : "Show"} ${board.name} occurrence`} aria-pressed={visible} onClick={() => props.onVisibility(board.id, !visible)}>
            {visible ? <Eye size={15}/> : <EyeOff size={15}/>}<span>{visible ? "Shown" : "Hidden"}</span>
          </button>
        </div>;
      })}
      {!boards.length && <p>No resolved board occurrences</p>}
    </div>

    <div className="assembly-handling-tools">
      <div className="assembly-tool-buttons" aria-label="Viewport move tool">
        <button type="button" disabled={!selected} onClick={() => props.onMoveMode("translate")}><Move3d size={15}/> Move</button>
        <button type="button" disabled={!selected} onClick={() => props.onMoveMode("rotate")}><Rotate3d size={15}/> Rotate</button>
      </div>
      <fieldset className="assembly-placement-fields" disabled={!placement}>
        <legend>Assembly position and XYZ angles</legend>
        {placementFields.map(field => <label key={field.axis}><span>{field.label} <small>{field.unit}</small></span><CommitNumberInput label={`${field.label} ${field.unit}`} value={placement?.[field.axis] ?? 0} onCommit={value => applyField(field.axis, value)}/></label>)}
      </fieldset>
      {placementError && <p className="assembly-placement-error" role="alert">{placementError}</p>}
      <label className="assembly-explode-control"><span>Explode <small>mm</small></span><CommitNumberInput label="Exploded distance mm" min={0} value={props.explodedDistanceMm} onCommit={props.onExplodedDistance}/><small>Separates each occurrence and its result overlay.</small></label>
      <fieldset className="assembly-snap-controls" disabled={!selected}>
        <legend>Alignment snap</legend>
        <div className="assembly-snap-mode-buttons">{(["off", "hole", "edge"] as const).map(mode => <button className={props.snapMode === mode ? "selected" : ""} aria-pressed={props.snapMode === mode} key={mode} type="button" onClick={() => props.onSnapMode(mode)}>{mode === "off" ? "Off" : `${mode[0].toUpperCase()}${mode.slice(1)} snap`}</button>)}</div>
        {props.onSnapGapChange && <label className="assembly-snap-gap"><span>Clearance <small>mm</small></span><CommitNumberInput label="Snap clearance mm" min={0} value={props.snapGapMm ?? 0} onCommit={props.onSnapGapChange}/></label>}
        {props.snapSourceLabel && <small className="assembly-snap-hint" title={props.snapSourceLabel}>Source: {props.snapSourceLabel}. Click the target to align.</small>}
      </fieldset>
    </div>
  </section>;
}
