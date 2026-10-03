import type { ParsedBoard } from "./boardParser";

export type ImportStage = "parsing" | "layout" | "board" | "components" | "ready" | "cancelled";
export type ImportProblem = { source: string; references: string[] };
export type BoardImportProgress = {
  fileName: string; stage: ImportStage; percent: number; label: string;
  startedAt: number; busy: boolean; warnings: string[]; problems: ImportProblem[];
};

export const IMPORT_STAGES = [
  { stage: "layout", label: "Loading 2D layers", start: 15, end: 40 },
  { stage: "board", label: "Preparing the 3D board", start: 40, end: 60 },
  { stage: "components", label: "Resolving and loading 3D parts", start: 60, end: 95 },
] as const;

export function useNativeCopperForImport(board: ParsedBoard, sourceBytes: number): boolean {
  // Large CAD copper tessellations can exceed the IPC budget by themselves.
  // Native display geometry retains the complete source layer inventory.
  return sourceBytes >= 8 * 1024 * 1024
    || board.tracks.length + board.pads.length + board.vias.length >= 25_000;
}

export function missingModelProblems(board: ParsedBoard, paths: string[], missingReferences?: readonly string[]): ImportProblem[] {
  const missing = missingReferences === undefined ? null : new Set(missingReferences);
  return [...new Set(paths)].map(source => ({
    source,
    references: board.components.filter(component => (!missing || missing.has(component.ref)) && (component.modelPaths ?? [component.modelPath]).includes(source)).map(component => component.ref),
  })).filter(problem => !missing || problem.references.length > 0);
}
