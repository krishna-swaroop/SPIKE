// SPDX-License-Identifier: Apache-2.0
import { Component, useMemo, useState, type ReactNode } from "react";
import BoardViewport, { type BoardObject } from "./engine/BoardViewport";
import type { ParsedBoard } from "./engine/boardTypes";
import type { BoardBinding, VirtualLayer, VirtualPick } from "./overlays/types";
import { validateVirtualLayers } from "./overlays/validation";
import "./style.css";

export type BoardViewerProps = {
  board: ParsedBoard;
  binding: BoardBinding;
  mode?: "2D" | "3D";
  layers?: readonly VirtualLayer[];
  frameIndex?: number;
  cameraCommand?: string;
  visibleLayers?: Record<string, boolean>;
  layerOpacity?: Record<string, number>;
  layerSeparation?: number;
  showModels?: boolean;
  showNetNames?: boolean;
  onSelect?: (selection: BoardObject) => void;
  onVirtualPick?: (pick: VirtualPick) => void;
};
const NO_LAYERS: VirtualLayer[] = [];
const NO_OP = () => {};

class ViewportBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <div role="alert" className="spike-viewer-error"><b>Viewport could not start</b><p>{this.state.error}</p><button onClick={() => this.setState({ error: "" })}>Retry viewport</button></div> : this.props.children;
  }
}

/** Portable high-level viewport. Board objects and arrays must be treated as immutable. */
export function BoardViewer({ board, binding, mode = "3D", layers = NO_LAYERS, frameIndex = 0, cameraCommand = "", visibleLayers, layerOpacity = {}, layerSeparation = 0, showModels = true, showNetNames = true, onSelect, onVirtualPick }: BoardViewerProps) {
  const [selected, setSelected] = useState<BoardObject | null>(null);
  const eventTarget = useMemo(() => new EventTarget(), []);
  const defaults = useMemo(() => Object.fromEntries(board.layerDefinitions.map(layer => [layer.name, true])), [board]);
  const admission = useMemo(() => {
    try {
      if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new Error("Frame index must be a non-negative integer");
      return { layers: validateVirtualLayers(layers, binding), error: "" };
    } catch (error) { return { layers: NO_LAYERS, error: error instanceof Error ? error.message : "Invalid virtual layer data" }; }
  }, [layers, binding.boardId, binding.revision, frameIndex]);
  return <div className="spike-viewer" aria-label={`${mode} board viewer`}>
    {admission.error && <div className="spike-viewer-admission" role="alert">Virtual layers rejected: {admission.error}</div>}
    <ViewportBoundary key={`${binding.boardId}:${binding.revision}`}>
      <BoardViewport board={board} eventTarget={eventTarget} viewMode={mode} visibleLayers={visibleLayers ?? defaults} layerOpacity={layerOpacity}
        layerSeparation={layerSeparation} showVias showModels={showModels} showSmdModels={showModels} showThtModels={showModels}
        navigationMode="orbit" navigationInertia={false} showAxes selectionBlink={false}
        cameraCommand={cameraCommand} selectionFilter="all" selectedId={selected?.id ?? null}
        selectedNet={selected?.net} selectedPosition={selected?.position} showNetNames={showNetNames}
        onSelect={value => { setSelected(value); onSelect?.(value); }} onCamera={NO_OP}
        virtualLayers={admission.layers} virtualFrameIndex={frameIndex} onVirtualPick={onVirtualPick}/>
    </ViewportBoundary>
  </div>;
}
