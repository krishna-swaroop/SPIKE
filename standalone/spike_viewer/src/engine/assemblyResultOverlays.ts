// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import type { ParsedBoard } from "./boardTypes";
import type { VirtualBoardVisual } from "./harnessVisualization";

type Provenance = {
  contract: string;
  modelStatus: string;
  requestDigest?: string;
  solver?: string;
  limitations: string[];
};

export type AssemblyResultMetric = {
  kind: "uniform_lumped_temperature" | "board_power" | "si_channel" | "em_loop";
  name: string;
  value?: number;
  unit?: "degC" | "W" | "A" | "Hz";
  scope: string;
  detail?: Readonly<Record<string, number | string>>;
};

export type AssemblyBoardResultOverlay = {
  boardOccurrenceId: string;
  metrics: AssemblyResultMetric[];
  provenance: Provenance[];
};

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const text = (value: unknown) => typeof value === "string" ? value : "";
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function provenance(payload: Obj): Provenance {
  const native = object(payload.native_result), nativeProvenance = object(native?.provenance);
  return {
    contract: text(payload.contract) || "unknown",
    modelStatus: text(payload.model_status) || "unknown",
    requestDigest: text(payload.request_digest) || undefined,
    solver: text(nativeProvenance?.solver) || text(object(payload.provenance)?.engine) || undefined,
    limitations: strings(payload.limitations),
  };
}

function add(target: Map<string, AssemblyBoardResultOverlay>, boardId: string, metric: AssemblyResultMetric, source: Provenance) {
  if (!boardId) return;
  const row = target.get(boardId) ?? { boardOccurrenceId: boardId, metrics: [], provenance: [] };
  row.metrics.push(metric);
  if (!row.provenance.some(item => item.contract === source.contract && item.requestDigest === source.requestDigest)) row.provenance.push(source);
  target.set(boardId, row);
}

function normalizeThermal(payload: Obj, target: Map<string, AssemblyBoardResultOverlay>, source: Provenance) {
  if (payload.contract !== "spike/multiboard-thermal-result/v1" || payload.status !== "completed") return;
  for (const raw of Array.isArray(payload.nodes) ? payload.nodes : []) {
    const node = object(raw), boardId = text(node?.board_id), temperature = finite(node?.temperature_c ?? node?.steady_temperature_c);
    if (!node || !boardId || temperature === null || node.local_node_id !== "board") continue;
    const power = finite(node.power_w);
    add(target, boardId, {
      kind: "uniform_lumped_temperature", name: "Uniform lumped board temperature", value: temperature, unit: "degC",
      scope: `${boardId}:${text(node.local_node_id) || "board"}`,
      detail: power === null ? undefined : { power_w: power },
    }, source);
  }
}

function ownerFromElementId(id: string) {
  const match = /^element\["([^"]+)",/.exec(id);
  return match?.[1] ?? "";
}

function normalizePi(payload: Obj, target: Map<string, AssemblyBoardResultOverlay>, source: Provenance) {
  if (payload.contract !== "spike/multiboard-circuit-result/v1" || payload.domain !== "pi" || payload.status !== "completed") return;
  const power = object(object(object(payload.native_result)?.data)?.element_power_w);
  if (!power) return;
  const totals = new Map<string, number>();
  for (const [id, raw] of Object.entries(power)) {
    const boardId = ownerFromElementId(id), value = finite(raw);
    // Board load power is an occurrence-scoped sum. Connector link loss remains assembly-scoped.
    if (boardId && value !== null && value > 0) totals.set(boardId, (totals.get(boardId) ?? 0) + value);
  }
  totals.forEach((value, boardId) => add(target, boardId, { kind: "board_power", name: "Board dissipated power", value, unit: "W", scope: boardId }, source));
}

function normalizeSi(payload: Obj, target: Map<string, AssemblyBoardResultOverlay>, source: Provenance) {
  if (payload.contract !== "spike/multiboard-circuit-result/v1" || payload.domain !== "si" || payload.status !== "completed") return;
  const data = object(object(payload.native_result)?.data), map = object(payload.node_map);
  const frequencies = Array.isArray(data?.frequency_hz) ? data.frequency_hz.map(finite) : [];
  if (!frequencies.length || frequencies.some(value => value === null)) return;
  const voltages = object(data?.node_voltage_v);
  if (!map || !voltages) return;
  for (const [boardId, rawNodes] of Object.entries(map)) for (const [terminal, rawResultId] of Object.entries(object(rawNodes) ?? {})) {
    const resultId = text(rawResultId), channel = object(voltages[resultId]);
    const magnitudes = Array.isArray(channel?.magnitude) ? channel.magnitude.map(finite) : [];
    if (!resultId || magnitudes.length !== frequencies.length || magnitudes.some(value => value === null)) continue;
    const lastFrequency = frequencies[frequencies.length - 1] as number;
    add(target, boardId, { kind: "si_channel", name: terminal, scope: `${boardId}:${terminal}`, value: lastFrequency, unit: "Hz", detail: { samples: frequencies.length, result_id: resultId } }, source);
  }
}

function normalizeEm(payload: Obj, target: Map<string, AssemblyBoardResultOverlay>, source: Provenance) {
  if (payload.contract !== "spike/multiboard-em-result/v1" || payload.status !== "completed") return;
  // This contract returns explicit lumped loop currents. It does not return a spatial or full-wave field.
  for (const rawSample of Array.isArray(payload.samples) ? payload.samples : []) {
    const sample = object(rawSample), frequency = finite(sample?.frequency_hz);
    if (!sample || frequency === null) continue;
    for (const rawLoop of Array.isArray(sample.loops) ? sample.loops : []) {
      const loop = object(rawLoop), boardId = text(loop?.board_id), current = finite(loop?.current_magnitude_a);
      if (!loop || !boardId || current === null) continue;
      const loss = finite(loop.loss_w);
      add(target, boardId, { kind: "em_loop", name: text(loop.loop_id) || "Lumped magnetic loop", value: current, unit: "A", scope: `${boardId}:${text(loop.loop_id)}`, detail: { frequency_hz: frequency, ...(loss === null ? {} : { loss_w: loss }) } }, source);
    }
  }
}

/** Admit only finite, occurrence-scoped values from implemented multiboard contracts. */
export function normalizeAssemblyResultOverlays(payloads: unknown[]): AssemblyBoardResultOverlay[] {
  const target = new Map<string, AssemblyBoardResultOverlay>();
  for (const raw of payloads) {
    const payload = object(raw);
    if (!payload) continue;
    const source = provenance(payload);
    normalizeThermal(payload, target, source);
    normalizePi(payload, target, source);
    normalizeSi(payload, target, source);
    normalizeEm(payload, target, source);
  }
  return [...target.values()].map(row => ({ ...row, metrics: row.metrics.slice(), provenance: row.provenance.slice() }));
}

export type AssemblyResultOverlaySceneOptions = {
  sourceParsedBoard: ParsedBoard;
  visual: VirtualBoardVisual;
  summary: AssemblyBoardResultOverlay;
};

function thermalColor(celsius: number) {
  return new THREE.Color().setHSL(Math.max(0, Math.min(.66, .66 - (celsius - 20) / 90)), .85, .52);
}

/** Build source-local-mm graphics. Add this group beneath the board occurrence group. */
export function buildAssemblyResultOverlayGroup({ sourceParsedBoard: board, visual, summary }: AssemblyResultOverlaySceneOptions) {
  const group = new THREE.Group();
  group.name = `assembly-result-overlays:${visual.id}`;
  group.userData.boardOccurrenceId = visual.id;
  group.userData.resultOverlaySummary = summary;
  const z = (visual.thicknessMm ?? 1.6) / 2 + .18;
  const temperature = summary.metrics.find(metric => metric.kind === "uniform_lumped_temperature" && metric.value !== undefined);
  if (temperature?.value !== undefined) {
    const width = Math.max(.01, board.bounds.maxX - board.bounds.minX), height = Math.max(.01, board.bounds.maxY - board.bounds.minY);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: thermalColor(temperature.value), transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set((board.bounds.minX + board.bounds.maxX) / 2 - visual.localCenterMm[0], (board.bounds.minY + board.bounds.maxY) / 2 - visual.localCenterMm[1], z);
    mesh.name = "uniform-lumped-board-temperature";
    mesh.userData = { resultMetric: temperature, representation: "uniform_lumped_board_temperature", spatialField: false };
    group.add(mesh);
  }
  const labels = summary.metrics.filter(metric => metric !== temperature);
  labels.forEach((metric, index) => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.55, 12, 8), new THREE.MeshBasicMaterial({ color: metric.kind === "board_power" ? 0xffb13b : metric.kind === "si_channel" ? 0x54c9ff : 0xc18cff }));
    marker.position.set(board.bounds.minX - visual.localCenterMm[0] + 1.2 + index * 1.35, board.bounds.maxY - visual.localCenterMm[1] - 1.2, z + .15);
    marker.name = `${metric.kind}:${metric.scope}`;
    marker.userData = { resultMetric: metric, representation: "occurrence_scoped_label_marker", spatialField: false };
    group.add(marker);
  });
  return group;
}

/** Parenting is the transform contract: explosion/placement moves overlay and board together. */
export function attachAssemblyResultOverlay(occurrenceGroup: THREE.Object3D, options: AssemblyResultOverlaySceneOptions) {
  const overlay = buildAssemblyResultOverlayGroup(options);
  occurrenceGroup.add(overlay);
  return overlay;
}
