// SPDX-License-Identifier: Apache-2.0
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";
import type { ParsedLayerDefinition, ParsedStackupLayer } from "./boardParser";
import type { NetCatalogRow } from "./NetCatalog";
import { netOccurrences } from "./assemblyBoardManagerModel";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
export const managerDefaultLayerVisible = (name: string) => name === "Board body" || name.endsWith(".Cu") || name.endsWith(".Mask") || name.endsWith(".SilkS") || name === "Edge.Cuts";

/** Project only the selected retained design; never join nets by their display names. */
export function assemblyManagerPresentation(assembly: AssemblyIr, designs: AssemblyDesigns, boardId: string) {
  const board = assembly.boards.find(board => board.id === boardId);
  const design = designs.designs.find(design => design.design_id === board?.design_id);
  const materials = new Map(rows(design?.materials).map(row => [text(row.id), row]));
  const layers = rows(design?.layers);
  const definitions: ParsedLayerDefinition[] = [];
  const stackup: ParsedStackupLayer[] = [];
  const layerNames = new Map<string, string>();
  const copperIds: string[] = [];
  layers.forEach((layer, index) => {
    const extensions = record(layer.extensions), source = record(extensions["spike.v1"]), stack = record(extensions["spike.v1.stackup"]);
    const name = text(layer.name ?? stack.name ?? source.name) || `Layer ${index + 1}`;
    const kind = text(layer.layer_type ?? layer.kind ?? layer.type ?? stack.type);
    const dielectric = /dielectric|core|prepreg|substrate|insulator/i.test(kind);
    const material = materials.get(text(layer.material_id)) ?? {};
    const properties = record(material.properties);
    layerNames.set(text(layer.id), name);
    if (kind === "copper" || name.endsWith(".Cu")) copperIds.push(text(layer.id));
    if (!dielectric) definitions.push({ id: number(source.id) ?? index, name, kind: text(source.type) || (name.endsWith(".Cu") ? "signal" : "user"), userName: text(source.user_name) || undefined });
    const thickness = number(layer.thickness_mm ?? stack.thickness_mm ?? stack.thickness);
    if (dielectric || thickness !== undefined || Object.keys(stack).length) stackup.push({
      name, type: text(stack.type) || kind, thickness, material: text(stack.material) || text(material.name) || undefined,
      epsilonR: number(stack.epsilon_r ?? stack.epsilonR ?? properties.relative_permittivity),
      lossTangent: number(stack.loss_tangent ?? stack.lossTangent ?? properties.loss_tangent), color: text(stack.color) || undefined,
    });
  });
  const nets = netOccurrences(assembly, designs).filter(net => net.boardId === boardId);
  const buckets = new Map(nets.map(net => [net.netId, { tracks: 0, vias: 0, pads: 0, zones: 0, layers: new Set<string>(), parts: new Set<string>() }]));
  const omittedCollections = record(record(design?.metadata).transport_projection).omitted_collections;
  const unavailable = new Set(Array.isArray(omittedCollections) ? omittedCollections.map(String) : []);
  const available = (key: string) => Array.isArray(design?.[key]) && !unavailable.has(key);
  for (const key of ["tracks", "arcs", "vias", "pads", "zones"] as const) {
    for (const object of rows(design?.[key])) {
      const bucket = buckets.get(text(object.net_id)); if (!bucket) continue;
      bucket[key === "arcs" ? "tracks" : key]++;
      let ids = Array.isArray(object.layer_ids) ? object.layer_ids.map(String) : [text(object.layer_id)];
      if (key === "vias") {
        const start = copperIds.indexOf(text(object.start_layer_id)), end = copperIds.indexOf(text(object.end_layer_id));
        if (start >= 0 && end >= 0) ids = copperIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      }
      ids.filter(id => copperIds.includes(id)).forEach(id => bucket.layers.add(layerNames.get(id) ?? id));
      if (key === "pads" && text(object.component_id)) bucket.parts.add(text(object.component_id));
    }
  }
  const catalog: NetCatalogRow[] = nets.map(net => {
    const bucket = buckets.get(net.netId)!;
    return { id: net.netId, name: net.name, metrics: {
      tracks: available("tracks") && available("arcs") ? bucket.tracks : null,
      vias: available("vias") ? bucket.vias : null, pads: available("pads") ? bucket.pads : null,
      zones: available("zones") ? bucket.zones : null, parts: available("pads") ? bucket.parts.size : null,
      layers: ["tracks", "arcs", "vias", "pads", "zones"].every(available) ? bucket.layers.size : null,
    } };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { definitions, stackup, catalog };
}
