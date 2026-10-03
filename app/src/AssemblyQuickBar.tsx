// SPDX-License-Identifier: Apache-2.0
import type { VirtualBoardVisual } from "./harnessVisualization";
type Props = { boards: readonly VirtualBoardVisual[]; selectedId: string | null; visibility: Record<string, boolean>; expanded: boolean; moveMode?: "translate" | "rotate" | null; onMoveMode?: (mode: "translate" | "rotate") => void;
  onSelect: (boardId: string) => void; onVisibility: (boardId: string, visible: boolean) => void; onExpand: () => void;
  onWorkspace: () => void; onLayers: () => void; onNets: () => void; onLinks: () => void };
export default function AssemblyQuickBar(props: Props) {
  const selected = props.boards.find(board => board.id === props.selectedId);
  return <section className="assembly-quick-bar" aria-label="Multi-board viewport controls">
    <b title={`${props.boards.length} board occurrences`}>ASSEMBLY · {props.boards.length}</b>
    <select aria-label="Selected assembly board" value={selected?.id ?? ""} onChange={event => props.onSelect(event.target.value)}><option value="">Select a board…</option>{props.boards.map(board => <option key={board.id} value={board.id}>{board.name} · {board.id}</option>)}</select>
    <button type="button" disabled={!selected} onClick={() => selected && props.onVisibility(selected.id, props.visibility[selected.id] === false)}>{selected && props.visibility[selected.id] === false ? "Show board" : "Hide board"}</button>
    <button type="button" disabled={!selected} aria-pressed={props.moveMode === "translate"} onClick={() => props.onMoveMode?.("translate")}>Move</button>
    <button type="button" disabled={!selected} aria-pressed={props.moveMode === "rotate"} onClick={() => props.onMoveMode?.("rotate")}>Rotate</button>
    <button type="button" aria-pressed={props.expanded} onClick={props.onExpand}>Placement</button>
    <button type="button" onClick={props.onLayers}>Layers</button><button type="button" onClick={props.onNets}>Nets</button><button type="button" onClick={props.onLinks}>Links</button><button type="button" onClick={props.onWorkspace}>Workspace</button>
  </section>;
}
