export const EXPLICIT_MESH_REQUEST_CONTRACT = "spike/gmsh-occ-mesh/v1";
export const FOCUSED_PCB_MESH_REQUEST_CONTRACT = "spike/pcb-volume-mesh-request/v1";

export type ManualFocusRegion = {
  id: string;
  bounds_mm: [[number, number, number], [number, number, number]];
  target_size_mm: number;
};

export type FocusedPcbMeshRequest = Record<string, any> & {
  contract: typeof FOCUSED_PCB_MESH_REQUEST_CONTRACT;
  model: {
    contract: "spike/pcb-volume-model/v1";
    copper: Array<{ id: string; net: string; layer_id: string }>;
    vias: Array<{ id: string; net: string }>;
  };
  sizing: {
    contract: "spike/pcb-focus-sizing/v1";
    net_names: string[];
    source_ids: string[];
    fine_size_mm: number;
    coarse_size_mm: number;
    halo_mm: number;
    growth_rate: number;
    regions: ManualFocusRegion[];
  };
  resources: { max_cells: number; max_vertices: number };
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const identity = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
const uniqueIdentities = (value: unknown) => Array.isArray(value) && value.length <= 10_000 && value.every(identity) && new Set(value).size === value.length;

export function isFocusedPcbMeshRequest(value: unknown): value is FocusedPcbMeshRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as any).contract === FOCUSED_PCB_MESH_REQUEST_CONTRACT);
}

export function validateFocusedPcbMeshRequest(value: unknown): FocusedPcbMeshRequest {
  if (!isFocusedPcbMeshRequest(value)) throw new Error(`Expected a ${FOCUSED_PCB_MESH_REQUEST_CONTRACT} request.`);
  const request = value as FocusedPcbMeshRequest;
  const model = request.model;
  const sizing = request.sizing;
  const resources = request.resources;
  if (!model || model.contract !== "spike/pcb-volume-model/v1" || !Array.isArray(model.copper) || !Array.isArray(model.vias)) throw new Error("Whole-board request requires a normalized PCB volume model.");
  const sources = [...model.copper, ...model.vias];
  if (sources.length > 10_000 || sources.some(item => !item || !identity(item.id) || !identity(item.net)) || new Set(sources.map(item => item.id)).size !== sources.length) throw new Error("PCB copper and via sources require unique IDs and net names.");
  if (!sizing || sizing.contract !== "spike/pcb-focus-sizing/v1" || !uniqueIdentities(sizing.net_names) || !uniqueIdentities(sizing.source_ids)) throw new Error("Focused sizing selectors are invalid.");
  const knownNets = new Set(sources.map(item => item.net));
  const knownSources = new Set(sources.map(item => item.id));
  if (sizing.net_names.some(net => !knownNets.has(net)) || sizing.source_ids.some(id => !knownSources.has(id))) throw new Error("Focused sizing contains an unknown net or source selector.");
  if (!finite(sizing.fine_size_mm) || !finite(sizing.coarse_size_mm) || sizing.fine_size_mm <= 0 || sizing.coarse_size_mm < sizing.fine_size_mm) throw new Error("Sizing requires 0 < fine size ≤ coarse background size.");
  if (!finite(sizing.halo_mm) || sizing.halo_mm < 0 || !finite(sizing.growth_rate) || sizing.growth_rate <= 0 || sizing.growth_rate > 1) throw new Error("Sizing halo or growth rate is invalid.");
  if (!Array.isArray(sizing.regions) || sizing.regions.length > 4096 || sizing.regions.some(region => !validRegion(region, sizing.coarse_size_mm))) throw new Error("Manual focus regions are invalid.");
  if (!sizing.net_names.length && !sizing.source_ids.length && !sizing.regions.length) throw new Error("Select at least one net, source, or manual region.");
  if (!resources || !Number.isInteger(resources.max_cells) || !Number.isInteger(resources.max_vertices) || resources.max_cells < 4 || resources.max_cells > 100_000 || resources.max_vertices < 4 || resources.max_vertices > 100_000) throw new Error("PCB mesh output budgets must be integers from 4 to 100,000.");
  return request;
}

function validRegion(region: any, coarse: number) {
  return region && identity(region.id) && Array.isArray(region.bounds_mm) && region.bounds_mm.length === 2 && region.bounds_mm.every((point: unknown) => Array.isArray(point) && point.length === 3 && point.every(finite)) && region.bounds_mm[0].every((value: number, axis: number) => value <= region.bounds_mm[1][axis]) && finite(region.target_size_mm) && region.target_size_mm > 0 && region.target_size_mm <= coarse;
}

export function focusedMeshInventory(request: FocusedPcbMeshRequest) {
  const sources = [...request.model.copper.map(item => ({ ...item, kind: "copper" as const })), ...request.model.vias.map(item => ({ ...item, layer_id: "via span", kind: "via" as const }))];
  return { nets: [...new Set(sources.map(item => item.net))].sort((a, b) => a.localeCompare(b)), sources: sources.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function updateFocusedSizing(request: FocusedPcbMeshRequest, patch: Partial<FocusedPcbMeshRequest["sizing"]>): FocusedPcbMeshRequest {
  return { ...request, sizing: { ...request.sizing, ...patch } };
}

export function focusedMeshFeedback(result: any) {
  const counts = result?.focus_assessment?.counts;
  const metrics = result?.metrics;
  const cad = metrics?.cad_volume_mm3;
  const tetra = metrics?.tetrahedron_volume_mm3;
  const volumeError = finite(cad) && cad > 0 && finite(tetra) ? Math.abs(tetra / cad - 1) : null;
  const mappedSources = result?.mesh?.object_map && typeof result.mesh.object_map === "object" ? Object.keys(result.mesh.object_map).length : null;
  const coveredSources = metrics?.source_cad_volumes_mm3 && typeof metrics.source_cad_volumes_mm3 === "object" ? Object.keys(metrics.source_cad_volumes_mm3).length : null;
  return {
    minimumQuality: finite(metrics?.minimum_mean_ratio_quality) ? metrics.minimum_mean_ratio_quality : null,
    volumeError,
    mappedSources,
    coveredSources,
    nearFocusCells: Number.isInteger(counts?.near_focus) ? counts.near_focus : null,
    farFieldCells: Number.isInteger(counts?.far_field) ? counts.far_field : null,
    aboveTargetCells: Number.isInteger(counts?.above_target) ? counts.above_target : null,
    maximumEdgeRatio: finite(result?.focus_assessment?.maximum_edge_to_target_ratio) ? result.focus_assessment.maximum_edge_to_target_ratio : null,
    wholeModelRetained: result?.whole_model_retained === true,
  };
}
