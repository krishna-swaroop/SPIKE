// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const plotlyStub = { name: "chart-dependency-stubs", setup(build) {
  build.onResolve({ filter: /^\.\/PlotlyChart$/ }, () => ({ path: "PlotlyChart", namespace: "test-stub" }));
  build.onResolve({ filter: /^\.\/DataTable$/ }, () => ({ path: "DataTable", namespace: "test-stub" }));
  build.onLoad({ filter: /^PlotlyChart$/, namespace: "test-stub" }, () => ({ contents: "export default function PlotlyChart(){ return null; }", loader: "js" }));
  build.onLoad({ filter: /^DataTable$/, namespace: "test-stub" }, () => ({ contents: "import React from 'react'; export default function DataTable({children,label}){ return React.createElement('table',{'aria-label':label},children); }", loader: "js" }));
} };
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/acPowerIntegrityReport.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", external: ["react", "react-dom/server"], loader: { ".css": "empty" }, plugins: [plotlyStub] });
const code = bundle.outputFiles[0].text
  .replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href)}`)
  .replaceAll('from "react"', `from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)}`)
  .replaceAll('from "react-dom/server"', `from ${JSON.stringify(new URL("../node_modules/react-dom/server.node.js", import.meta.url).href)}`);
const { buildAcPowerIntegrityReport } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const request = { contract: "spike/ac-pi-request/v1", length_m: .12, frequencies_hz: [1000, 2000], load_impedance_ohm: [20, -5] };
const result = { contract: "spike/ac-pi-result/v1", status: "completed", model_status: "experimental_not_validated", analysis_id: "ac-report-fixture",
  samples: [{ frequency_hz: 1000, status: "computed", load_voltage_v_rms: [1, 0], input_impedance_ohm: [3, 4] },
    { frequency_hz: 2000, status: "singular_source_load_resonance" }] };
const html = buildAcPowerIntegrityReport("Fixture <script> & board", request, result);
assert.match(html, /Fixture &lt;script&gt; &amp; board/);
assert.match(html, /Table of contents/);
assert.match(html, /id="report-opening"/);
assert.match(html, /id="report-closing"/);
assert.match(html, /id="ac-setup"/);
assert.match(html, /length m<\/th><td>0\.12/);
assert.match(html, /experimental_not_validated/);
assert.match(html, /actual returned samples/);
assert.match(html, /data-spike-plot=/);
assert.match(html, /data-plot-traces/);
assert.match(html, /data-frequency-hz="1000" data-value="5"/, "static report retains the exact 3-4-5 impedance sample");
assert.match(html, /singular_source_load_resonance/);
assert.match(html, /does not perform geometry-derived board extraction/);
assert.match(html, /script-src 'unsafe-inline'/);
assert.match(html, /window\.print\(\)/);
assert.doesNotMatch(html, /src="https?:/);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size);
for (const link of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(link[1]));
const missing = buildAcPowerIntegrityReport("Missing setup fixture", null, result);
assert.match(missing, /Submitted parameters were not retained/);
assert.doesNotMatch(missing, /length m<\/th>/);
const hostile = buildAcPowerIntegrityReport("</style><script>reportMetadataAttack()</script>", null, result);
assert.doesNotMatch(hostile, /<script>reportMetadataAttack/);
assert.match(hostile, /\\3c \/style\\3e /);
console.log("AC report: submitted setup, escaped metadata, actual sample plots, qualification and print navigation preserved.");
