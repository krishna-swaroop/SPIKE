// SPDX-License-Identifier: Apache-2.0
import { numericMaximum, numericMinimum } from "./numericRange";
/** Sampled network review, never an interpolated bandwidth or validation claim. */
export type EMergePortReview = {
  port: string; sampleCount: number; bestMatchHz: number; bestSiiDb: number | null;
  returnLossDb: number | null; vswr: number | null;
  matchedSampleSpansHz: [number, number][];
};
export type EMergeTransmissionReview = {
  receive: string; excited: string; minimumDb: number | null; maximumDb: number | null;
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const db = (magnitude: number): number | null => magnitude > 0 ? 20 * Math.log10(magnitude) : null;

export function emergeAnalysisPayload(value: unknown): Record<string, unknown> {
  const root = record(value);
  return record(record(root.data).analysis_result ?? root.analysis_result ?? value);
}

export function reviewEMergeNetwork(value: unknown): { ports: EMergePortReview[]; transmissions: EMergeTransmissionReview[]; issue: string | null } {
  const payload = emergeAnalysisPayload(value), provenance = record(payload.provenance), summary = record(payload.summary);
  const empty = (issue: string | null) => ({ ports: [], transmissions: [], issue });
  if (!["completed", "completed_with_warnings"].includes(String(payload.status)) || provenance.solved === false || summary.solved === false
      || provenance.failure_stage || summary.failure_stage || ["failed", "unsupported", "blocked"].includes(String(payload.model_status))) return empty("No completed solved network is available.");
  const network = record(record(payload.networks).s_parameters);
  if (!Object.keys(network).length) return empty(null);
  const frequencies = network.frequencies_hz, names = network.ports, values = network.values;
  if (!Array.isArray(frequencies) || !frequencies.length || frequencies.length > 64 || !Array.isArray(names) || !names.length || names.length > 32
      || names.some(name => typeof name !== "string" || !name) || new Set(names).size !== names.length
      || !Array.isArray(values) || frequencies.length !== values.length
      || frequencies.some((frequency, index) => !finite(frequency) || frequency <= 0 || (index > 0 && frequency <= frequencies[index - 1]))) return empty("Malformed S-parameter sweep; sampled analytics are unavailable.");
  const magnitudes: number[][][] = [];
  for (const matrix of values) {
    if (!Array.isArray(matrix) || matrix.length !== names.length) return empty("Malformed S-parameter matrix; sampled analytics are unavailable.");
    const decoded: number[][] = [];
    for (const row of matrix) {
      if (!Array.isArray(row) || row.length !== names.length) return empty("Malformed S-parameter matrix; sampled analytics are unavailable.");
      const decodedRow: number[] = [];
      for (const pair of row) {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(finite)) return empty("Nonfinite or malformed S-parameter sample; sampled analytics are unavailable.");
        const magnitude = Math.hypot(pair[0], pair[1]);
        if (!Number.isFinite(magnitude)) return empty("Nonfinite S-parameter magnitude; sampled analytics are unavailable.");
        decodedRow.push(magnitude);
      }
      decoded.push(decodedRow);
    }
    magnitudes.push(decoded);
  }
  const ports = names.map((port: string, portIndex: number): EMergePortReview => {
    const samples = magnitudes.map(matrix => matrix[portIndex][portIndex]);
    const best = samples.reduce((selected, magnitude, index) => magnitude < samples[selected] ? index : selected, 0);
    const matchedSampleSpansHz: [number, number][] = [];
    let start: number | null = null;
    samples.forEach((magnitude, index) => {
      if (magnitude <= Math.pow(10, -10 / 20)) { if (start === null) start = index; }
      else if (start !== null) { matchedSampleSpansHz.push([frequencies[start], frequencies[index - 1]]); start = null; }
    });
    if (start !== null) matchedSampleSpansHz.push([frequencies[start], frequencies[frequencies.length - 1]]);
    const bestSiiDb = db(samples[best]);
    return { port, sampleCount: samples.length, bestMatchHz: frequencies[best], bestSiiDb,
      returnLossDb: bestSiiDb === null ? null : -bestSiiDb,
      vswr: samples[best] < 1 ? (1 + samples[best]) / (1 - samples[best]) : null, matchedSampleSpansHz };
  });
  const transmissions = names.flatMap((receive: string, row: number) => names.flatMap((excited: string, column: number) => {
    if (row === column) return [];
    const samples = magnitudes.map(matrix => matrix[row][column]);
    return [{ receive, excited, minimumDb: db(numericMinimum(samples)), maximumDb: db(numericMaximum(samples)) }];
  }));
  return { ports, transmissions, issue: null };
}

export function emergeNetworkReportHtml(value: unknown): string {
  if (!value) return "";
  const payload = emergeAnalysisPayload(value), review = reviewEMergeNetwork(value);
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const format = (value: number | null) => value === null ? "unavailable" : value.toPrecision(6);
  const rows = review.ports.map(port => `<tr><td>${escape(port.port)}</td><td>${format(port.bestMatchHz)}</td><td>${format(port.bestSiiDb)}</td><td>${format(port.returnLossDb)}</td><td>${format(port.vswr)}</td><td>${port.matchedSampleSpansHz.map(span => span.map(format).join(" to ")).join("; ") || "none"}</td></tr>`).join("");
  const transmissionRows = review.transmissions.map(term => `<tr><td>${escape(term.receive)} &larr; ${escape(term.excited)}</td><td>${format(term.minimumDb)}</td><td>${format(term.maximumDb)}</td></tr>`).join("");
  const issues = Array.isArray(payload.issues) ? payload.issues.map(item => `<li>${escape(record(item).message ?? record(item).code)}</li>`).join("") : "";
  const summary = record(payload.summary), setup = record(summary.setup), network = record(record(payload.networks).s_parameters);
  const tableRows = (items: unknown, columns: string[]) => Array.isArray(items) ? items.slice(0, 64).map(item => `<tr>${columns.map(column => `<td>${escape(record(item)[column] ?? "unavailable")}</td>`).join("")}</tr>`).join("") : "";
  const copperRows = tableRows(summary.copper_layers, ["name", "z_mm"]);
  const dielectricRows = tableRows(summary.dielectric_layers, ["name", "thickness_mm", "epsilon_r", "loss_tangent", "z_top_mm", "z_bottom_mm"]);
  const portRows = tableRows(setup.ports, ["signal_pad_id", "signal_layer", "return_pad_id", "return_layer", "width_mm", "reference_impedance_ohm"]);
  const controlKeys = ["reference_impedance_ohm", "include_dielectric_loss", "air_margin_mm", "sparse_solver", "parallel", "n_workers", "radiation_theta_step_deg", "radiation_phi_step_deg", "radiation_cut_phi_deg", "field_excited_port", "nearfield_enabled", "nearfield_z_mm", "nearfield_grid_points"];
  const controlHtml = `<h3>Solver and field controls</h3><table class="data-table"><tbody>${controlKeys.filter(key => setup[key] !== undefined).map(key => `<tr><th>${escape(key.replace(/_/g, " "))}</th><td>${escape(setup[key])}</td></tr>`).join("")}</tbody></table>`;
  const field = record(record(payload.fields).nearfield);
  const fieldPlanes = Array.isArray(field.planes) ? field.planes : [];
  const fieldHtml = fieldPlanes.length ? `<h3>Complex near-field plane evidence</h3><table class="data-table"><thead><tr><th>Frequency (Hz)</th><th>Grid</th><th>Valid / total samples</th><th>Excited port</th></tr></thead><tbody>${fieldPlanes.map(item => { const plane = record(item); const valid = Array.isArray(plane.valid) ? plane.valid : []; return `<tr><td>${escape(plane.frequency_hz)}</td><td>${escape(Array.isArray(plane.grid_shape) ? plane.grid_shape.join(" × ") : "unavailable")}</td><td>${valid.filter(value => value === true).length} / ${valid.length}</td><td>${escape(plane.excitation_port ?? field.excitation_port ?? setup.field_excited_port ?? "unavailable")}</td></tr>`; }).join("")}</tbody></table><p>Complex electric (V/m) and magnetic (A/m) samples use solver modal excitation coefficients. Input-power calibration is required to interpret absolute field amplitudes. Invalid points remain excluded; use SPIKE field probes and complex CSV for the original components.</p>` : "";
  const setupHtml = `<h3>Solver and setup provenance</h3><table class="summary-table"><tr><th>Engine</th><td>${escape(summary.engine ?? "EMerge")} ${escape(summary.engine_version ?? "unavailable")}</td><th>Geometry backend</th><td>${escape(summary.geometry_backend ?? "unavailable")} ${escape(summary.geometry_backend_version ?? "version unavailable")}</td></tr><tr><th>Modeled nets</th><td>${escape(Array.isArray(summary.modeled_nets) ? summary.modeled_nets.join(" / ") : "unavailable")}</td><th>Geometry status</th><td>${escape(summary.geometry_status ?? "unavailable")}</td></tr><tr><th>Requested sweep (Hz)</th><td>${escape(setup.frequency_start_hz ?? "unavailable")} to ${escape(setup.frequency_stop_hz ?? "unavailable")}; ${escape(setup.frequency_points ?? "unavailable")} points</td><th>Requested mesh (mm)</th><td>${escape(setup.mesh_resolution_mm ?? "unavailable")}</td></tr><tr><th>Reference impedance (ohm)</th><td>${escape(network.reference_impedance_ohm ?? "unavailable")}</td><th>Copper polygons / planar cell estimate</th><td>${escape(summary.copper_polygon_count ?? "unavailable")} / ${escape(setup.planar_cell_estimate ?? "unavailable")}</td></tr></table>${copperRows ? `<h3>Copper stack</h3><table class="data-table"><thead><tr><th>Layer</th><th>Depth z (mm)</th></tr></thead><tbody>${copperRows}</tbody></table>` : ""}${dielectricRows ? `<h3>Dielectric materials</h3><table class="data-table"><thead><tr><th>Layer</th><th>Thickness (mm)</th><th>Relative permittivity</th><th>Loss tangent</th><th>Top z (mm)</th><th>Bottom z (mm)</th></tr></thead><tbody>${dielectricRows}</tbody></table>` : ""}${portRows ? `<h3>Explicit vertical ports</h3><table class="data-table"><thead><tr><th>Signal pad</th><th>Signal layer</th><th>Return pad</th><th>Return layer</th><th>Width (mm)</th><th>Reference (ohm)</th></tr></thead><tbody>${portRows}</tbody></table>` : ""}`;
  return `<section id="emerge-network-review"><h2>EMerge sampled network review</h2><p>Result status: ${escape(payload.status ?? "unavailable")}. Model status: ${escape(payload.model_status ?? "unavailable")}. Case digest: ${escape(record(payload.provenance).board_case_sha256 ?? record(payload.provenance).case_digest ?? record(payload.summary).case_digest ?? "unavailable")}.</p>${setupHtml}${controlHtml}${fieldHtml}${review.issue ? `<p>${escape(review.issue)}</p>` : `<table class="data-table"><thead><tr><th>Port</th><th>Best sampled match (Hz)</th><th>Sii (dB)</th><th>Return loss (dB)</th><th>VSWR at match</th><th>Sampled Sii &lt;= -10 dB spans (Hz)</th></tr></thead><tbody>${rows || "<tr><td colspan='6'>No network samples returned.</td></tr>"}</tbody></table>${transmissionRows ? `<table class="data-table"><thead><tr><th>Transmission</th><th>Minimum magnitude (dB)</th><th>Maximum magnitude (dB)</th></tr></thead><tbody>${transmissionRows}</tbody></table>` : ""}`}<p>All extrema and spans use returned samples only. Span endpoints are sampled frequencies, not interpolated bandwidth boundaries; isolated matches have zero span. Zero magnitude has no finite dB value. VSWR is unavailable for |Sii| &gt;= 1. No passivity, gain, efficiency, compliance, or validation claim is inferred.</p>${issues ? `<ul>${issues}</ul>` : ""}</section>`;
}
