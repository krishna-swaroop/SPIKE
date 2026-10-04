// SPDX-License-Identifier: Apache-2.0
export type PiTerminalRole = "source" | "load" | "source_return" | "load_return";

/** Blank coordinates are unassigned; explicit zero is a valid coordinate. */
export function piTerminalPosition(item: { x: string; y: string }): [number, number] | null {
  if (!item.x.trim() || !item.y.trim()) return null;
  const x = Number(item.x), y = Number(item.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function removePiTerminal<T extends {
  sources: { id: string }[]; loads: { id: string }[];
  returnPath: { sources: { id: string }[]; loads: { id: string }[] };
}>(setup: T, role: PiTerminalRole, id: string): T {
  const kind = role.startsWith("source") ? "sources" : "loads";
  if (role.endsWith("_return")) return { ...setup, returnPath: {
    ...setup.returnPath, [kind]: setup.returnPath[kind].filter(item => item.id !== id),
  } };
  return { ...setup, [kind]: setup[kind].filter(item => item.id !== id) };
}
