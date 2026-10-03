// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { ACPISamplePlots } from "./ACPowerIntegrityEffects";
import { formatReportDocument } from "./reportPresentation";

export function buildAcPowerIntegrityReport(projectName: string, request: Record<string, unknown> | null, result: Record<string, unknown>) {
  const generatedAt = new Date().toISOString();
  const reportId = String(result.analysis_id ?? `AC-PI-${generatedAt}`);
  const body = renderToStaticMarkup(<main className="report-main">
    <button onClick={undefined} id="ac-print-report">Print / save PDF</button>
    <section id="ac-summary"><h2>Study summary and validity</h2><p>Experimental uniform passive line with explicit RLGC, source and load. Optional slab skin and imposed-field proximity losses. This model does not perform geometry-derived board extraction. Source: 1 V RMS; phasor convention exp(+j omega t).</p><table className="summary-table"><tbody><tr><th>Result status</th><td>{String(result.status ?? "Not recorded")}</td></tr><tr><th>Model status</th><td>{String(result.model_status ?? "Not recorded")}</td></tr></tbody></table></section>
    <section id="ac-setup"><h2>Submitted setup and assumptions</h2><p>Parameter values use SI units unless their name explicitly states another unit. The saved request describes the submitted model; editing the form requires another run.</p><table className="summary-table"><tbody>{Object.entries(request ?? {}).map(([name, value]) => <tr key={name}><th>{name.replace(/_/g, " ")}</th><td>{typeof value === "object" ? JSON.stringify(value) : String(value)}</td></tr>)}</tbody></table>{!request && <p>Submitted parameters were not retained.</p>}</section>
    <section id="ac-results"><h2>AC response and sample plots</h2><ACPISamplePlots result={result} interactive={false} /></section>
    <section id="ac-evidence"><h2>Reproducibility evidence</h2><p>Retain the request and full returned evidence with this report.</p><details><summary>Full returned numerical evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></section>
  </main>);
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><title>AC power integrity effects</title><style>svg{width:100%;max-height:250px}.acpi-plots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.acpi-plots figure{margin:0;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:700px){.acpi-plots{grid-template-columns:1fr}}</style></head><body>${body}<script>document.getElementById('ac-print-report').addEventListener('click',function(){window.print()})</script></body></html>`;
  return formatReportDocument(document, { title: "AC Power Integrity Report", projectName, reportId, generatedAt,
    opening: "This report records the submitted passive line model and its returned AC response. Review the assumptions before applying the result to a physical design.",
    closing: "Review the response across the submitted frequency range and retain the limitations of the uniform line model. Correlate a physical board application with geometry-derived or measured evidence before qualification.",
  });
}
