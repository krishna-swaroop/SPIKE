// SPDX-License-Identifier: Apache-2.0
import { retainedDesignBoardEnvelope, separatedBoardTransform } from "./assemblyBoardDraft";
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";

export type BoardInstance = Record<string, unknown> & { id: string; name?: string; design_id: string;
  frame: { frame_id: string; parent_frame_id: string; transform: number[] } };

/** Immutable source designs are shared; occurrence state and frame identity are independent. */
export function duplicateBoardInstance(assembly: AssemblyIr, designs: AssemblyDesigns | null, source: BoardInstance, id: string): BoardInstance {
  if (assembly.boards.length >= 30) throw new Error("An assembly supports up to 30 board instances.");
  if (!id || id.includes(":") || [...assembly.boards, ...assembly.parts].some(board => board.id === id || (board.frame as BoardInstance["frame"] | undefined)?.frame_id === `${id}-frame`)) {
    throw new Error("The new board needs a unique instance and frame identity.");
  }
  const index = new Map((designs?.designs ?? []).map(design => [design.design_id, design]));
  const occurrence = (board: BoardInstance) => ({ transform: board.frame.transform, envelope: retainedDesignBoardEnvelope(index.get(board.design_id)) });
  const usedNames = new Set(assembly.boards.map(board => String(board.name ?? "").toLocaleLowerCase()));
  const base = `${source.name || "Board"} copy`;
  let name = base, suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) name = `${base} ${suffix++}`;
  return { ...structuredClone(source), id, name,
    frame: { ...structuredClone(source.frame), frame_id: `${id}-frame`,
      transform: separatedBoardTransform((assembly.boards as BoardInstance[]).map(occurrence), occurrence(source)) } };
}

/** Only explicit occurrence references create dependencies; source/net names never do. */
export function linkReferencesBoard(row: Record<string, unknown>, boardId: string): boolean {
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
  return [row, data].some(value => [value.board_id, value.board_a_id, value.board_b_id].includes(boardId)
    || [value.endpoint_a, value.endpoint_b].some(endpoint => typeof endpoint === "string" && endpoint.split(":", 1)[0] === boardId));
}

export function removeBoardInstance(assembly: AssemblyIr, boardId: string): { assembly: AssemblyIr; removedLinks: number } {
  const result = { ...assembly, boards: assembly.boards.filter(board => board.id !== boardId) };
  let removedLinks = 0;
  for (const field of ["harnesses", "connector_mappings", "rigid_flex_links"] as const) {
    result[field] = (assembly[field] ?? []).filter(row => {
      const remove = linkReferencesBoard(row, boardId);
      if (remove) removedLinks++;
      return !remove;
    });
  }
  return { assembly: result, removedLinks };
}
