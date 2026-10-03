// SPDX-License-Identifier: Apache-2.0

export type MinimizedToolItem = {
  id: string;
  label: string;
  restore: () => void | Promise<void>;
  close?: () => void | Promise<void>;
};

type Listener = (items: readonly MinimizedToolItem[]) => void;

const items = new Map<string, MinimizedToolItem>();
const listeners = new Set<Listener>();

function snapshot(): MinimizedToolItem[] {
  return [...items.values()];
}

function publish(): void {
  const current = snapshot();
  listeners.forEach(listener => listener(current));
}

/** Registers or refreshes a minimized in-workspace tool without moving state authority out of its owner. */
export function minimizeTool(item: MinimizedToolItem): boolean {
  // Standalone renderer fixtures have no application shelf. Keep their tool
  // visible instead of creating an unreachable minimized state.
  if (!listeners.size || !item.id.trim() || !item.label.trim()) return false;
  items.set(item.id, item);
  publish();
  return true;
}

export function removeMinimizedTool(id: string): void {
  if (items.delete(id)) publish();
}

export async function restoreMinimizedTool(id: string): Promise<void> {
  const item = items.get(id);
  if (!item) return;
  const index = [...items.keys()].indexOf(id);
  items.delete(id);
  publish();
  try {
    await item.restore();
  } catch (error) {
    const current = [...items.values()].filter(candidate => candidate.id !== id);
    current.splice(Math.max(0, Math.min(index, current.length)), 0, item);
    items.clear();
    current.forEach(candidate => items.set(candidate.id, candidate));
    publish();
    throw error;
  }
}

export async function closeMinimizedTool(id: string): Promise<void> {
  const item = items.get(id);
  if (!item?.close) return;
  const index = [...items.keys()].indexOf(id);
  items.delete(id);
  publish();
  try {
    await item.close();
  } catch (error) {
    const current = [...items.values()].filter(candidate => candidate.id !== id);
    current.splice(Math.max(0, Math.min(index, current.length)), 0, item);
    items.clear();
    current.forEach(candidate => items.set(candidate.id, candidate));
    publish();
    throw error;
  }
}

export function minimizedToolSnapshot(): readonly MinimizedToolItem[] {
  return snapshot();
}

export function subscribeMinimizedTools(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}
