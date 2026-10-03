// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import * as THREE from "three";
import { resolveFrameToAssembly, type AssemblyFrame, type AssemblyIr } from "./mcadAssembly";

export function placeAssemblyBoard(assembly: AssemblyIr, boardId: string, world: number[]): AssemblyIr {
  const board = assembly.boards.find(row => row.id === boardId);
  if (!board || world.length !== 16 || !world.every(Number.isFinite)) throw new Error("Invalid board placement");
  const frame = board.frame as AssemblyFrame;
  const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const parent = resolveFrameToAssembly(assembly, { ...frame, transform: identity });
  if (!parent) throw new Error("Board parent frame cannot be resolved");
  const matrix = new THREE.Matrix4().fromArray(parent).transpose().invert()
    .multiply(new THREE.Matrix4().fromArray(world).transpose());
  const local = matrix.clone().transpose().toArray();
  if (Math.max(Math.abs(world[3]), Math.abs(world[7]), Math.abs(world[11])) > 1000) throw new Error("Board placement exceeds the 1 m assembly limit");
  return { ...assembly, boards: assembly.boards.map(row => row.id === boardId ? { ...row, frame: { ...frame, transform: local } } : row) };
}

export default function BoardPlacementTool({ boardId, onCommit }: { boardId: string; onCommit: (world: number[]) => void }) {
  const [mode, setMode] = useState<"translate" | "rotate" | null>(null);
  useEffect(() => {
    const partId = `board:${boardId}`;
    window.dispatchEvent(new CustomEvent("spike-mcad-gizmo-config", { detail: { partId, enabled: Boolean(mode), mode: mode ?? "translate", translationSnapMm: 1, rotationSnapDeg: 5 } }));
    const commit = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.partId === partId && Array.isArray(detail.assemblyTransform)) onCommit(detail.assemblyTransform);
    };
    window.addEventListener("spike-mcad-transform-commit", commit);
    return () => {
      window.removeEventListener("spike-mcad-transform-commit", commit);
      window.dispatchEvent(new CustomEvent("spike-mcad-gizmo-config", { detail: { partId, enabled: false } }));
    };
  }, [boardId, mode, onCommit]);
  return <div className="panel-block"><strong>Board placement</strong><p>Drag the viewport axes. Translation snaps to 1 mm; rotation to 5°. Save the project to retain placement.</p>
    <button className="plain-btn" onClick={() => setMode(mode === "translate" ? null : "translate")}>Move board</button>
    <button className="plain-btn" onClick={() => setMode(mode === "rotate" ? null : "rotate")}>Rotate board</button>
  </div>;
}
