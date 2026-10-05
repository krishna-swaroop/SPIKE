// SPDX-License-Identifier: Apache-2.0
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";

export type AssemblyBoardOccurrence = { id: string; name: string; designId: string };
export type AssemblyLayerOccurrence = { occurrenceId: string; boardId: string; designId: string; layerId: string; name: string; kind: string; thicknessMm: number | null; material: string };
export type AssemblyNetOccurrence = { occurrenceId: string; boardId: string; designId: string; netId: string; name: string };
export type AssemblyConnectorOccurrence = { occurrenceId: string; boardId: string; connectorId: string; name: string; pins: Array<{ id: string; net: AssemblyNetOccurrence | null }> };
export type ExplicitNetLinkRow = { id: string; sourceId?: string; sourceKind?: "harness" | "connector-mate"; endpointA: string; pinA: string; endpointB: string; pinB: string; applied: boolean };

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" ? value : "";
export const assemblyOccurrenceId = (boardId: string, entityId: string) => `${boardId}::${entityId}`;

export function boardOccurrences(assembly: AssemblyIr, designs: AssemblyDesigns): AssemblyBoardOccurrence[] {
  const known = new Set(designs.designs.map(item => item.design_id));
  return assembly.boards.flatMap(item => {
    const id = text(item.id), designId = text(item.design_id);
    return id && known.has(designId) ? [{ id, designId, name: text(item.name) || id }] : [];
  });
}

function designIndex(designs: AssemblyDesigns) { return new Map(designs.designs.map(item => [item.design_id, item])); }

export function layerOccurrences(assembly: AssemblyIr, designs: AssemblyDesigns): AssemblyLayerOccurrence[] {
  const index = designIndex(designs);
  return boardOccurrences(assembly, designs).flatMap(board => {
    const design = index.get(board.designId);
    const stackup = Array.isArray(design?.layers) ? design.layers : (Array.isArray(design?.stackup) ? design.stackup : []);
    const materials = new Map((Array.isArray(design?.materials) ? design.materials : []).flatMap(value => {
      const item = record(value), id = text(item?.id ?? item?.material_id); return item && id ? [[id, item] as const] : [];
    }));
    return stackup.flatMap((value, position) => {
      const item = record(value); if (!item) return [];
      const extensions = record(item.extensions), nativeStackup = record(extensions?.["spike.v1.stackup"]);
      const layerId = text(item.id ?? item.layer_id ?? item.name ?? nativeStackup?.name) || `layer-${position + 1}`;
      const materialId = text(item.material_id ?? item.material), material = materials.get(materialId);
      return [{ occurrenceId: assemblyOccurrenceId(board.id, layerId), boardId: board.id, designId: board.designId, layerId,
        name: text(item.name ?? nativeStackup?.name) || layerId,
        kind: text(item.layer_type ?? item.kind ?? item.type ?? nativeStackup?.type) || "unspecified",
        thicknessMm: typeof (item.thickness_mm ?? item.thickness ?? nativeStackup?.thickness_mm ?? nativeStackup?.thickness) === "number"
          ? Number(item.thickness_mm ?? item.thickness ?? nativeStackup?.thickness_mm ?? nativeStackup?.thickness) : null,
        material: text(material?.name ?? material?.display_name) || materialId }];
    });
  });
}

export function netOccurrences(assembly: AssemblyIr, designs: AssemblyDesigns): AssemblyNetOccurrence[] {
  const index = designIndex(designs);
  return boardOccurrences(assembly, designs).flatMap(board => {
    const design = index.get(board.designId);
    return (Array.isArray(design?.nets) ? design.nets : []).flatMap((value, position) => {
      const item = record(value); if (!item) return [];
      const netId = text(item.id ?? item.net_id) || `net-${position + 1}`;
      return [{ occurrenceId: assemblyOccurrenceId(board.id, netId), boardId: board.id, designId: board.designId, netId, name: text(item.name) || "Unnamed net" }];
    });
  });
}

export function connectorOccurrences(assembly: AssemblyIr, designs: AssemblyDesigns): AssemblyConnectorOccurrence[] {
  const nets = netOccurrences(assembly, designs);
  const byBoard = new Map<string, AssemblyNetOccurrence[]>();
  for (const net of nets) byBoard.set(net.boardId, [...(byBoard.get(net.boardId) ?? []), net]);
  const result: AssemblyConnectorOccurrence[] = [];
  for (const raw of assembly.connector_mappings ?? []) {
    const mapping = record(raw), data = record(mapping?.data); if (!mapping || !data || mapping.kind === "connector-mate") continue;
    const boardId = text(data.board_id), connectorId = text(data.connector_id ?? mapping.id), pins = record(data.pins);
    if (!boardId || !connectorId || !pins) continue;
    const boardNets = byBoard.get(boardId) ?? [];
    result.push({ occurrenceId: assemblyOccurrenceId(boardId, connectorId), boardId, connectorId,
      name: text(data.name ?? mapping.name) || connectorId,
      pins: Object.entries(pins).map(([id, value]) => {
        const identity = text(value);
        const exact = boardNets.find(net => net.netId === identity);
        const matches = exact ? [exact] : boardNets.filter(net => net.name === identity);
        return { id, net: matches.length === 1 ? matches[0] : null };
      }) });
  }
  return result;
}

export function explicitNetLinkRows(assembly: AssemblyIr): ExplicitNetLinkRow[] {
  const rows: ExplicitNetLinkRow[] = (assembly.harnesses ?? []).flatMap(raw => {
    const harness = record(raw), pinMap = record(harness?.pin_map); if (!harness || !pinMap) return [];
    const sourceId = text(harness.id);
    return Object.entries(pinMap).map(([pinA, pinB]) => ({ id: `harness:${sourceId}:${pinA}`, sourceId, sourceKind: "harness" as const,
      endpointA: text(harness.endpoint_a), pinA, endpointB: text(harness.endpoint_b), pinB: text(pinB), applied: true }));
  });
  rows.push(...(assembly.connector_mappings ?? []).flatMap(raw => {
    const mapping = record(raw), data = record(mapping?.data), pinMap = record(data?.pin_map);
    if (!mapping || mapping.kind !== "connector-mate" || !data || !pinMap) return [];
    const sourceId = text(mapping.id);
    return Object.entries(pinMap).map(([pinA, pinB]) => ({ id: `connector-mate:${sourceId}:${pinA}`, sourceId, sourceKind: "connector-mate" as const,
      endpointA: text(data.endpoint_a), pinA, endpointB: text(data.endpoint_b), pinB: text(pinB), applied: true }));
  }));
  return rows;
}

export function removeExplicitNetLink(assembly: AssemblyIr, row: ExplicitNetLinkRow): AssemblyIr {
  if (!row.sourceId || !row.sourceKind) return assembly;
  if (row.sourceKind === "harness") return { ...assembly, harnesses: (assembly.harnesses ?? []).map(raw => {
    if (text(raw.id) !== row.sourceId) return raw;
    const next = { ...(record(raw.pin_map) ?? {}) }; delete next[row.pinA];
    return { ...raw, pin_map: next };
  }) };
  return { ...assembly, connector_mappings: (assembly.connector_mappings ?? []).flatMap(raw => {
    if (text(raw.id) !== row.sourceId) return [raw];
    const data = record(raw.data) ?? {}, next = { ...(record(data.pin_map) ?? {}) }; delete next[row.pinA];
    return Object.keys(next).length ? [{ ...raw, data: { ...data, pin_map: next } }] : [];
  }) };
}

export function replaceExplicitNetLink(assembly: AssemblyIr, original: ExplicitNetLinkRow, replacement: ExplicitNetLinkRow): AssemblyIr {
  if (!original.sourceId || !original.sourceKind || !replacement.endpointA || !replacement.endpointB || !replacement.pinA || !replacement.pinB) throw new Error("Choose both connectors and pins before saving.");
  if (replacement.endpointA !== original.endpointA || replacement.endpointB !== original.endpointB) throw new Error("Connector endpoints belong to the saved harness or mate. Add a new explicit row to link different connectors.");
  if (original.sourceKind === "harness") return { ...assembly, harnesses: (assembly.harnesses ?? []).map(raw => {
    if (text(raw.id) !== original.sourceId) return raw;
    const next = { ...(record(raw.pin_map) ?? {}) };
    if (replacement.pinA !== original.pinA && Object.prototype.hasOwnProperty.call(next, replacement.pinA)) throw new Error("That source pin already has a mapping in this link. Edit its existing row instead.");
    delete next[original.pinA]; next[replacement.pinA] = replacement.pinB;
    return { ...raw, pin_map: next };
  }) };
  return { ...assembly, connector_mappings: (assembly.connector_mappings ?? []).map(raw => {
    if (text(raw.id) !== original.sourceId) return raw;
    const data = record(raw.data) ?? {}, next = { ...(record(data.pin_map) ?? {}) };
    if (replacement.pinA !== original.pinA && Object.prototype.hasOwnProperty.call(next, replacement.pinA)) throw new Error("That source pin already has a mapping in this link. Edit its existing row instead.");
    delete next[original.pinA]; next[replacement.pinA] = replacement.pinB;
    return { ...raw, data: { ...data, pin_map: next } };
  }) };
}

export function applyExplicitNetLink(assembly: AssemblyIr, row: ExplicitNetLinkRow): AssemblyIr {
  if (row.applied) return assembly;
  if (!row.endpointA || !row.endpointB || row.endpointA === row.endpointB || !row.pinA || !row.pinB) throw new Error("Choose two distinct connector occurrences and one pin on each connector.");
  const id = row.id || `connector-mate-${Date.now().toString(36)}`;
  const mate = { id, name: "Explicit net link", kind: "connector-mate", data: { endpoint_a: row.endpointA, endpoint_b: row.endpointB, pin_map: { [row.pinA]: row.pinB } } };
  return { ...assembly, connector_mappings: [...(assembly.connector_mappings ?? []), mate] };
}

export function validateExplicitNetLink(assembly: AssemblyIr, designs: AssemblyDesigns, row: ExplicitNetLinkRow): void {
  if (!row.endpointA || !row.endpointB || row.endpointA === row.endpointB || !row.pinA || !row.pinB) throw new Error("Choose two distinct connector occurrences and one pin on each connector.");
  const connectors = new Map(connectorOccurrences(assembly, designs).map(item => [item.occurrenceId, item]));
  const left = connectors.get(row.endpointA), right = connectors.get(row.endpointB);
  if (!left || !right) throw new Error("Both connector occurrences must exist in retained AssemblyIR mappings.");
  if (left.boardId === right.boardId) throw new Error("An assembly net link must connect distinct board occurrences.");
  if (!left.pins.some(pin => pin.id === row.pinA) || !right.pins.some(pin => pin.id === row.pinB)) throw new Error("Choose retained pins from both connector occurrences; a stale pin cannot be linked.");
  if (!left.pins.find(pin => pin.id === row.pinA)?.net || !right.pins.find(pin => pin.id === row.pinB)?.net) throw new Error("Both connector pins must resolve to retained board nets before saving a link.");
}
