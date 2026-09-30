// SPDX-License-Identifier: Apache-2.0
import { admitOptycalComparison, optycalRecord, type OptycalComparison } from "./optycalStudy";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const format = (value: number) => value.toPrecision(6);
function extent(values: number[]) {
  let low = Infinity, high = -Infinity;
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
  if (low === high) { if (low === 0) { low = -1; high = 1; } else if (low > 0) low = 0; else high = 0; }
  return [low, high];
}
function linePlot(data: OptycalComparison, keys: string[], unit: string): string {
  const samples = keys.map(key => data.theta.map((_, row) => data.series[key][row * data.phi.length]));
  const [low, high] = extent(samples.flat());
  const scale = Math.max(Math.abs(low), Math.abs(high), 1e-300);
  const colors = ["#126782", "#cf5c24"];
  const paths = samples.map((values, series) => `<polyline fill="none" stroke="${colors[series]}" stroke-width="2" points="${values.map((value, index) => `${70 + data.theta[index] / 180 * 650},${340 - (value / scale - low / scale) / (high / scale - low / scale) * 300}`).join(" ")}"/>`).join("");
  return `<svg viewBox="0 0 800 400" role="img" aria-label="${escape(unit)} at phi zero"><rect x="70" y="40" width="650" height="300" fill="#fafafa" stroke="#999"/>${[0, 45, 90, 135, 180].map(theta => `<text x="${70 + theta / 180 * 650}" y="360" text-anchor="middle">${theta}°</text>`).join("")}<text x="62" y="45" text-anchor="end">${format(high)}</text><text x="62" y="340" text-anchor="end">${format(low)}</text>${paths}<text x="390" y="388" text-anchor="middle">Theta (deg), phi = 0°</text></svg><p>${keys.map((key, index) => `<span style="color:${colors[index]}">${escape(key.replace(/_/g, " "))}</span>`).join(" · ")} · ${escape(unit)}. Straight segments connect the returned angular samples.</p>`;
}
function interferenceMap(data: OptycalComparison): string {
  const values = data.series.interference_cross_term;
  let scale = 0;
  for (const value of values) scale = Math.max(scale, Math.abs(value));
  const rectangles = data.theta.flatMap((theta, row) => data.phi.slice(0, -1).map((phi, column) => {
    if (row === data.theta.length - 1) return "";
    const value = values[row * data.phi.length + column];
    const alpha = scale ? Math.abs(value) / scale : 0;
    const color = value >= 0 ? `rgb(255,${Math.round(255 * (1 - alpha))},${Math.round(255 * (1 - alpha))})` : `rgb(${Math.round(255 * (1 - alpha))},${Math.round(255 * (1 - alpha))},255)`;
    return `<rect x="${70 + phi / 360 * 650}" y="${40 + theta / 180 * 300}" width="${(data.phi[column + 1] - phi) / 360 * 650}" height="${(data.theta[row + 1] - theta) / 180 * 300}" fill="${color}"><title>theta ${theta}, phi ${phi}: ${format(value)}</title></rect>`;
  })).join("");
  return `<svg viewBox="0 0 800 400" role="img" aria-label="Coherent interference angular map">${rectangles}<rect x="70" y="40" width="650" height="300" fill="none" stroke="#999"/><text x="390" y="380" text-anchor="middle">Phi (deg): 0 → 360</text><text x="15" y="190" transform="rotate(-90 15 190)" text-anchor="middle">Theta (deg): 0 → 180</text></svg><p>Blue: destructive · white: zero · red: constructive. Symmetric scale ±${format(scale)} relative to bare peak |E|². Each cell displays its lower-angle solved sample, without interpolation; the repeated phi = 360° seam is omitted from this map.</p>`;
}

/** Standalone report with no remote assets or inferred solver samples. */
export function optycalReportHtml(result: unknown): string {
  const envelope = optycalRecord(result);
  const payload = optycalRecord(optycalRecord(envelope.data).analysis_result ?? envelope.analysis_result ?? result);
  const rawComparison = optycalRecord(optycalRecord(payload.fields).comparison);
  const comparison = admitOptycalComparison(rawComparison);
  if (!comparison || !["completed", "completed_with_warnings"].includes(String(payload.status))) throw new Error("No completed Optycal comparison with finite complex fields is available for a report.");
  const metadata = (value: unknown) => Object.entries(optycalRecord(value)).map(([key, item]) => `<tr><th>${escape(key)}</th><td>${escape(typeof item === "object" ? JSON.stringify(item) : item)}</td></tr>`).join("");
  const issues = Array.isArray(payload.issues) ? payload.issues.map(issue => `<li>${escape(optycalRecord(issue).message ?? optycalRecord(issue).code)}</li>`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Optycal structure study — ${escape(payload.analysis_id)}</title><style>body{font:15px system-ui,sans-serif;max-width:1050px;margin:30px auto;padding:0 24px;color:#20313b}h1,h2{color:#126782}svg{width:100%;max-height:450px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7dc;text-align:left;vertical-align:top;padding:7px;overflow-wrap:anywhere}th{width:26%}.limits{background:#fff5df;border-left:4px solid #b67712;padding:15px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px}section{break-inside:avoid}button{padding:8px 15px}@media print{button,.evidence{display:none}body{margin:0;padding:0}h2{break-after:avoid}}</style></head><body><button onclick="window.print()">Print / save PDF</button><h1>Optycal antenna and structure study</h1><p>Analysis ${escape(payload.analysis_id)} · ${escape(rawComparison.frequency_hz)} Hz · Model status: <strong>${escape(payload.model_status)}</strong></p><div class="limits">One-way physical-optics scattering from a PEC structure illuminated by an EMerge far-zone antenna source. Both patterns use the same bare-field peak reference. Fields use arbitrary coherent units; no calibrated gain or radiated power is claimed. This study does not update S11, impedance or antenna–structure feedback. Dielectric transmission, near-field interaction, geometric shadowing, diffraction and multiple reflections are not modeled. Source phase/origin assumptions and far-zone clearance must be reviewed. Numerical results remain unvalidated.</div><section><h2>Bare and installed radiation cut</h2>${linePlot(comparison, ["bare_relative_db", "structure_relative_db"], "dB relative to bare peak")}</section><section><h2>Structure-induced amplitude change</h2>${linePlot(comparison, ["delta_db"], "installed / bare amplitude change (dB)")}</section><section><h2>Coherent interference</h2>${interferenceMap(comparison)}${linePlot(comparison, ["interference_cross_term"], "cross term in relative to bare peak |E|²")}</section><h2>Study setup and summary</h2><table>${metadata(payload.summary)}</table><h2>Provenance</h2><table>${metadata(payload.provenance)}</table><h2>Reported issues</h2><ul>${issues || "<li>No additional issues recorded.</li>"}</ul><details class="evidence"><summary>Complete returned evidence JSON</summary><pre>${escape(JSON.stringify(payload, null, 2))}</pre></details></body></html>`;
}
