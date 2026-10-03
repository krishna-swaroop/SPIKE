// SPDX-License-Identifier: Apache-2.0
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";

export type PythonBoardContext = { id: string; name: string; design_id: string; design: Record<string, unknown> };
export type PythonWorkspaceContext = { boards: PythonBoardContext[]; selected_board_id: string | null; assembly: AssemblyIr | null };
export type PythonNetContext = { boardId: string; boardName: string; id: string | number; name: string };
export type PythonUiAction = { action: "select_net"; board_id: string; net_id: string | number } | { action: "focus_board"; board_id: string } | { action: "open_panel"; panel: "layers" | "nets" | "connector_links" | "results" | "issues" };

export function pythonWorkspaceContext(design: Record<string, unknown> | null, assembly?: AssemblyIr | null, designs?: AssemblyDesigns | null, selected?: string | null): PythonWorkspaceContext {
  const index = new Map(designs?.designs.map(board => [board.design_id, board]) ?? []);
  const boards: PythonBoardContext[] = assembly?.boards.flatMap(board => {
    const id = String(board.id ?? ""), designId = String(board.design_id ?? ""), source = index.get(designId);
    return id && source ? [{ id, name: String(board.name ?? source.name ?? "Board"), design_id: designId, design: source }] : [];
  }) ?? [];
  if (!boards.length && design) {
    const id = String(design.design_id ?? "current-board");
    boards.push({ id, name: String(design.name ?? "Loaded board"), design_id: id, design });
  }
  return { boards, selected_board_id: selected && boards.some(board => board.id === selected) ? selected : boards.length === 1 ? boards[0].id : null, assembly: assembly ?? null };
}

export function pythonBoardNets(workspace: PythonWorkspaceContext): PythonNetContext[] {
  return workspace.boards.flatMap(board => (Array.isArray(board.design.nets) ? board.design.nets : []).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const net = value as Record<string, unknown>, id = net.id ?? net.net_id, name = String(net.name ?? "");
    return (typeof id === "number" && Number.isFinite(id) || typeof id === "string" && Boolean(id)) && name ? [{ boardId: board.id, boardName: board.name, id: id as string | number, name }] : [];
  }));
}

// Includes the entire snapshot so an asynchronous run cannot act on revised boards.
export function pythonContextKey(workspace: PythonWorkspaceContext) { return JSON.stringify(workspace); }

export function admittedPythonUiActions(value: unknown, workspace: PythonWorkspaceContext): PythonUiAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error("Invalid Python interface actions. Run the script again.");
  const boards = new Set(workspace.boards.map(board => board.id));
  const nets = new Set(pythonBoardNets(workspace).map(net => JSON.stringify([net.boardId, net.id])));
  return value.map(raw => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid Python interface action.");
    const action = raw as Record<string, unknown>;
    if (action.action === "open_panel" && ["layers", "nets", "connector_links", "results", "issues"].includes(String(action.panel))) return action as PythonUiAction;
    if (action.action === "focus_board" && typeof action.board_id === "string" && boards.has(action.board_id)) return action as PythonUiAction;
    if (action.action === "select_net" && typeof action.board_id === "string" && (typeof action.net_id === "string" || typeof action.net_id === "number") && nets.has(JSON.stringify([action.board_id, action.net_id]))) return action as PythonUiAction;
    throw new Error("Python interface target is unavailable. Reload the board and rerun the script.");
  });
}
