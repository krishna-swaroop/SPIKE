// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "./boardParser";
import type { BoardObject } from "./BoardViewport";
import type { VirtualBoardVisual } from "./harnessVisualization";

export type ViewportNetRow = { id: string; name: string; source: string; layer: string; object: BoardObject; canonical: boolean };

export function netViewerBoard(active: ParsedBoard | null, boards: readonly VirtualBoardVisual[], designs: Record<string, ParsedBoard>, selectedId: string | null) {
  if (boards.length <= 1) return { key: "single-board", label: "Board nets", board: active, occurrence: null };
  const occurrence = boards.find(board => board.id === selectedId) ?? null;
  return { key: occurrence?.id ?? "assembly:no-selection", label: occurrence?.name ?? "Select a board", occurrence,
    board: occurrence ? designs[occurrence.designId] ?? (occurrence.active ? active : null) : null };
}

/** Names describe rows; canonical IDs and board occurrences identify selection. */
export function viewportNetRows(board: ParsedBoard | null): ViewportNetRow[] {
  if (!board) return [];
  const anchors = new Map<string, { source: string; layer: string; object: BoardObject }>();
  const add = (name: string | undefined, source: string, object: BoardObject) => {
    if (name?.trim() && !anchors.has(name)) anchors.set(name, { source, layer: object.layer ?? "", object });
  };
  for (const pad of board.pads) add(pad.net, `${pad.ref ?? "Pad"}.${pad.name}`, { id: pad.id, type: "pad", name: `${pad.ref ?? "Pad"}.${pad.name}`, ref: pad.ref, net: pad.net, layer: pad.layers[0], layers: pad.layers, position: pad.at });
  for (const track of board.tracks) add(track.net, "Trace", { id: track.id, type: "trace", name: track.net ?? "Trace", net: track.net, layer: track.layer, position: track.start });
  for (const zone of board.zones) add(zone.net, "Zone", { id: zone.id, type: "zone", name: zone.net ?? "Zone", net: zone.net, layer: zone.layer, position: zone.points[0] });
  for (const via of board.vias) add(via.net, "Via", { id: via.id, type: "via", name: via.net ?? "Via", net: via.net, layer: via.layers[0], layers: via.layers, position: via.at });
  const rows: ViewportNetRow[] = [];
  const declared = new Set<string>();
  for (const [id, name] of Object.entries(board.nets)) {
    if (!name.trim()) continue;
    declared.add(name);
    const anchor = anchors.get(name);
    rows.push({ id, name, canonical: true, source: anchor?.source ?? "No copper anchor", layer: anchor?.layer ?? "",
      object: anchor?.object ?? { id: `net:${id}`, type: "trace", name, net: name } });
  }
  for (const [name, anchor] of anchors) if (!declared.has(name)) rows.push({ id: `geometry:${name}`, name, canonical: false, ...anchor });
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

export function filterViewportNets(rows: readonly ViewportNetRow[], query: string): ViewportNetRow[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => terms.every(term => `${row.name} ${row.source} ${row.layer}`.toLocaleLowerCase().includes(term)));
}
