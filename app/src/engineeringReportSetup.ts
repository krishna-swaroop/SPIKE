// SPDX-License-Identifier: Apache-2.0
import type { ReportInput } from "./engineeringReport";
import type { ReportDomain } from "./engineeringReportDomain";
import { placementFromTransform } from "./mcadAssembly";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const label = (key: string) => ({ meshTargetMm: "Mesh target (mm)", zoneCellMm: "Zone cell (mm)", viaPlatingMm: "Via plating (mm)", frequencyStart: "Start frequency (Hz)", frequencyStop: "Stop frequency (Hz)", frequencyPoints: "Frequency points", transientStopS: "Transient stop (s)", transientTimeStepS: "Transient time step (s)", drop: "Voltage-drop limit (mV)", density: "Current-density limit (A/mm2)" } as Record<string, string>)[key]
  ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

function parameterRows(value: unknown, prefix = "", depth = 0): [string, string][] {
  if (value === undefined || value === null) return [[prefix || "Setup", "Not recorded"]];
  if (typeof value !== "object") return [[prefix, String(value)]];
  if (depth >= 8) return [[prefix, "Additional nested setup retained in the saved project"]];
  if (Array.isArray(value)) {
    if (!value.length) return [[prefix, "None recorded"]];
    if (value.every(v => v === null || typeof v !== "object")) return [[prefix, value.map(v => String(v)).join(", ")]];
    return value.flatMap((v, i) => parameterRows(v, `${prefix} ${i + 1}`, depth + 1));
  }
  return Object.entries(record(value)).filter(([key, item]) => !(key === "mesh" && Array.isArray(item)) && !/^(?:.*_result|results?|resultSnapshot|resultRef|latest_result|latest_channel_result|field_result|component_result|source_board|source_text|artifact.*|scalar_fields|vector_fields|time_series|frames|nets|traces|samples|points_mm|analysis_result|net_id|canonical_net_id)$/i.test(key))
    .flatMap(([key, item]) => parameterRows(item, prefix ? `${prefix} / ${label(key)}` : label(key), depth + 1));
}

function table(rows: [string, string][]) {
  const retained = rows.slice(0, 300);
  return `<table class="summary-table"><tbody>${retained.map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join("") || "<tr><th>Setup</th><td>Not recorded</td></tr>"}</tbody></table>${rows.length > retained.length ? `<p class="report-caption">${rows.length - retained.length} additional setup rows remain in the saved project. This report is a bounded setup review.</p>` : ""}`;
}

export function buildReportSetupSection(input: ReportInput, domain: ReportDomain) {
  const project = record(input.projectPayload), analysis = record(project.analysis), assembly = record(project.assembly_ir);
  const settings = domain === "pi" ? { ...input.setup, limits: input.limits }
    : domain === "si" ? { selected_suite: input.si?.suite ?? "Not recorded", saved_setup: record(analysis.si), saved_topology: record(record(record(project.design).topologies).si) }
      : domain === "thermal" ? record(input.thermal?.scenario)
        : input.emi?.setup ?? {};
  const common: [string, string][] = [
    ["Design source", input.boardFile || "Not recorded"], ["Report discipline", domain.toUpperCase()],
    ["Analysis mode", input.analysisMode], ["Selected solver", String(analysis.solver_id ?? "Not recorded")],
    ["Formulation", String(analysis.formulation ?? "Not recorded")],
  ];
  const boards = Array.isArray(assembly.boards) ? assembly.boards.map(record) : [];
  const occurrences = boards.map((board, index) => {
    const transform = record(board.frame).transform;
    const placement = Array.isArray(transform) && transform.length === 16 && transform.every(Number.isFinite) ? placementFromTransform(transform) : null;
    return [String(board.name ?? board.label ?? `Board ${index + 1}`), placement
      ? `XYZ (${placement.xMm.toFixed(3)}, ${placement.yMm.toFixed(3)}, ${placement.zMm.toFixed(3)}) mm; rotation XYZ (${placement.rxDeg.toFixed(3)}, ${placement.ryDeg.toFixed(3)}, ${placement.rzDeg.toFixed(3)}) deg`
      : "Placement not recorded"] as [string, string];
  });
  const connections = Array.isArray(assembly.connector_mappings) ? assembly.connector_mappings : [];
  const harnesses = Array.isArray(assembly.harnesses) ? assembly.harnesses : [];
  const coupledModel = record(record(assembly.extensions)["spike.multiboard-studies"])[domain];
  return `<section id="study-setup"><h2>Study setup and assumptions</h2><p class="section-intro">These are the settings retained in the report snapshot. Solver provenance records the executed model. When either is absent, this report cannot establish that the current setup produced the attached result.</p><div class="setup-grid"><div><h3>Study context</h3>${table(common)}</div><div><h3>${domain.toUpperCase()} parameters and boundaries</h3>${table(parameterRows(settings))}</div></div>${boards.length ? `<h3>Assembly board placement</h3>${table(occurrences)}<h3>Inter-board connections and study models</h3>${table(parameterRows({ connector_mappings: connections, harnesses, thermal_contacts: assembly.thermal_contacts, coupled_study_model: coupledModel, study_models: project.studies }))}<p class="report-caption">Connections are explicit saved mappings. Equal net names on different boards do not establish electrical continuity.</p>` : ""}</section>`;
}
